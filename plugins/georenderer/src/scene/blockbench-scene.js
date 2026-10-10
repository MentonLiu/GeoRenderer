import { srgbToLinear } from '../core/math.js';
import { MAX_ENV_IMAGE_SIZE } from '../core/config.js';

// 只保留一份高分辨率转换结果，浏览预设时不会不断累积全景图内存。
let convertedCubemap = null;
let convertedEnvironment = null;
const linearByte = Float32Array.from({ length: 256 }, (_, value) => srgbToLinear(value / 255));
const loadingScenes = new WeakMap();
let selectedSceneId = '';
let sceneSelectionRequest = 0;
let previewModelOverrides = {};

// 恢复独立参照模型的启用覆盖表，不直接修改 Blockbench 主视图状态。
export function restoreBlockbenchPreviewModelOverrides(overrides) {
	previewModelOverrides = overrides && typeof overrides === 'object' ? { ...overrides } : {};
}

// 设置指定参照模型在 GeoRenderer 中的启用状态，并返回新的覆盖表副本。
export function setBlockbenchPreviewModelEnabled(id, enabled) {
	const model = typeof PreviewModel !== 'undefined' ? PreviewModel.models?.[id] : null;
	const nativeEnabled = !!(model && PreviewModel.getActiveModels?.().includes(model));
	if (!!enabled === nativeEnabled) delete previewModelOverrides[id];
	else previewModelOverrides[id] = !!enabled;
	if (enabled && model && !model.enabled) model.update?.();
	return { ...previewModelOverrides };
}

// 收集被 Blockbench 场景拥有的模型，用于排除重复列出的独立模型。
function sceneOwnedModels() {
	return new Set(
		Object.values(typeof PreviewScene !== 'undefined' ? PreviewScene.scenes || {} : {})
			.flatMap(item => item.preview_models || [])
	);
}

// 列出可供 GeoRenderer 独立控制的预览模型。
export function listBlockbenchPreviewModels() {
	const owned = sceneOwnedModels();
	const active = new Set(typeof PreviewModel !== 'undefined' && PreviewModel.getActiveModels
		? PreviewModel.getActiveModels() : []);
	return Object.values(typeof PreviewModel !== 'undefined' ? PreviewModel.models || {} : {})
		.filter(model => !model.internal && !owned.has(model) && model.model_3d?.isObject3D)
		.map(model => ({
			id: model.id, name: model.name || model.id,
			enabled: Object.hasOwn(previewModelOverrides, model.id) ? !!previewModelOverrides[model.id] : active.has(model)
		}));
}

// 按 ID 获取 Blockbench 预览场景，不存在时返回空值。
export function getBlockbenchScene(id) {
	return typeof PreviewScene !== 'undefined' ? PreviewScene.scenes?.[id] || null : null;
}

// 恢复场景选择并递增请求序号，使旧的异步选择结果失效。
export function restoreBlockbenchSceneSelection(id) {
	sceneSelectionRequest++;
	selectedSceneId = getBlockbenchScene(id)?.id || '';
	return activeBlockbenchScene();
}

// 请求场景所需许可和延迟资源，并确保场景模型已经启用。
async function prepareScene(scene, includeModels = true) {
	if (scene.require_minecraft_eula) {
		if (typeof MinecraftEULA === 'undefined' || !await MinecraftEULA.promptUser('preview_scenes')) return false;
	}
	if (loadingScenes.has(scene)) {
		await loadingScenes.get(scene);
	} else if (!scene.loaded && scene.lazyLoadFromWeb) {
		const pending = scene.lazyLoadFromWeb();
		loadingScenes.set(scene, pending);
		try { await pending; }
		catch (err) { scene.loaded = false; throw err; }
		finally { loadingScenes.delete(scene); }
	}
	for (const model of includeModels ? scene.preview_models || [] : []) {
		if (!model.enabled) model.update?.();
	}
	return true;
}

// 将方向向量映射到立方体面的编号和面内 UV 坐标。
function cubeFace(x, y, z) {
	const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
	if (ax >= ay && ax >= az) return x > 0 ? [0, -z / ax, -y / ax] : [1, z / ax, -y / ax];
	if (ay >= ax && ay >= az) return y > 0 ? [2, x / ay, z / ay] : [3, x / ay, -z / ay];
	return z > 0 ? [4, x / az, -y / az] : [5, -x / az, -y / az];
}

// 将六面体环境贴图转换为线性浮点等距柱状环境图。
export function cubemapToEquirect(cubemap, width, height) {
	const faces = cubemap && cubemap.image;
	if (!Array.isArray(faces) || faces.length !== 6) return null;
	const faceSize = Math.max(...faces.map(face => (face?.image || face)?.width || 0));
	width = width || Math.min(MAX_ENV_IMAGE_SIZE, Math.max(512, 4 * faceSize));
	height = height || Math.round(width / 2);
	const faceData = Array.from({ length: 6 }, (_, index) => {
		const face = faces[index];
		const image = face && (face.image || face);
		if (!image || !image.width || !image.height) throw new Error('Blockbench 环境贴图尚未加载完成');
		const canvas = document.createElement('canvas');
		canvas.width = image.width; canvas.height = image.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		context.drawImage(image, 0, 0);
		return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
	});
	const data = new Float32Array(width * height * 4);
	const longitudes = Array.from({ length: width }, (_, x) => {
		const longitude = 2 * Math.PI * ((x + 0.5) / width - 0.5);
		return [Math.cos(longitude), Math.sin(longitude)];
	});
	// 按纬度和经度逐像素采样，并对立方体面数据执行双线性插值。
	for (let y = 0; y < height; y++) {
		const latitude = Math.PI * (0.5 - (y + 0.5) / height);
		const cosLatitude = Math.cos(latitude), sinLatitude = Math.sin(latitude);
		for (let x = 0; x < width; x++) {
			const [index, u, v] = cubeFace(cosLatitude * longitudes[x][0], sinLatitude, cosLatitude * longitudes[x][1]);
			const face = faceData[index];
			const fx = Math.max(0, Math.min(face.width - 1, (u + 1) * 0.5 * face.width - 0.5));
			const fy = Math.max(0, Math.min(face.height - 1, (v + 1) * 0.5 * face.height - 0.5));
			const x0 = Math.floor(fx), y0 = Math.floor(fy);
			const x1 = Math.min(face.width - 1, x0 + 1), y1 = Math.min(face.height - 1, y0 + 1);
			const tx = fx - x0, ty = fy - y0;
			const p00 = (y0 * face.width + x0) * 4, p10 = (y0 * face.width + x1) * 4;
			const p01 = (y1 * face.width + x0) * 4, p11 = (y1 * face.width + x1) * 4;
			const destination = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) {
				const top = linearByte[face.data[p00 + channel]] * (1 - tx) + linearByte[face.data[p10 + channel]] * tx;
				const bottom = linearByte[face.data[p01 + channel]] * (1 - tx) + linearByte[face.data[p11 + channel]] * tx;
				data[destination + channel] = top * (1 - ty) + bottom * ty;
			}
			data[destination + 3] = 1;
		}
	}
	return { width, height, data };
}

// 检查六个立方体面是否已拥有可读取的完整图片。
function cubemapReady(cubemap) {
	const faces = cubemap?.image;
	return Array.isArray(faces) && faces.length === 6 && Array.from({ length: 6 }, (_, index) => faces[index]).every(face => {
		const image = face?.image || face;
		return image && image.width > 0 && image.height > 0
			&& (!('complete' in image) || (image.complete && image.naturalWidth > 0));
	});
}

// 等待立方体贴图完成加载，超时则中止，避免渲染循环永久等待。
async function waitForCubemap(cubemap, timeout = 15000) {
	const deadline = Date.now() + timeout;
	while (!cubemapReady(cubemap)) {
		if (Date.now() >= deadline) throw new Error('Blockbench 场景立方体贴图加载超时');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

// 加载指定场景并缓存其等距柱状环境转换结果。
export async function loadBlockbenchScene(id, { includeModels = true } = {}) {
	const scene = getBlockbenchScene(id);
	if (!scene) return null;
	if (!await prepareScene(scene, includeModels)) return null;
	if (!scene.cubemap) return { cubemap: null, environment: null };
	const cubemap = scene.cubemap;
	await waitForCubemap(cubemap);
	if (convertedCubemap !== cubemap) {
		convertedEnvironment = cubemapToEquirect(cubemap);
		convertedCubemap = cubemap;
	}
	return { cubemap, environment: convertedEnvironment };
}

// 合并场景模型、原生激活模型和用户独立覆盖后的最终模型列表。
export function activeBlockbenchPreviewModels() {
	const scene = activeBlockbenchScene();
	const sceneModels = scene?.preview_models || [];
	const owned = sceneOwnedModels();
	const nativeActive = typeof PreviewModel !== 'undefined' && PreviewModel.getActiveModels
		? PreviewModel.getActiveModels().filter(model => !owned.has(model)) : [];
	const independent = new Set(nativeActive);
	for (const model of Object.values(typeof PreviewModel !== 'undefined' ? PreviewModel.models || {} : {})) {
		if (owned.has(model) || !Object.hasOwn(previewModelOverrides, model.id)) continue;
		if (previewModelOverrides[model.id]) independent.add(model);
		else independent.delete(model);
	}
	return [...new Set([...sceneModels, ...independent])].filter(model => model?.model_3d?.isObject3D);
}

// 返回 Blockbench 中可选择的场景摘要列表。
export function listBlockbenchScenes() {
	if (typeof PreviewScene === 'undefined') return [];
	return Object.values(PreviewScene.scenes || {}).map(scene => ({
		id: scene.id,
		name: scene.name || scene.id,
		category: scene.category || 'other',
	}));
}

// 返回当前已选场景。
export function activeBlockbenchScene() {
	return getBlockbenchScene(selectedSceneId);
}

// 异步选择场景，并用请求序号丢弃过期的异步结果。
export async function selectBlockbenchScene(id) {
	const request = ++sceneSelectionRequest;
	if (!id) { selectedSceneId = ''; return true; }
	const scene = getBlockbenchScene(id);
	if (!scene) return false;
	if (!await prepareScene(scene)) return false;
	if (request !== sceneSelectionRequest) return false;
	selectedSceneId = id;
	return true;
}
