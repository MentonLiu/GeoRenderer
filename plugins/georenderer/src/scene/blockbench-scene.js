import { srgbToLinear } from '../core/math.js';

const convertedCubemaps = new WeakMap();
let selectedSceneId = '';
let previewModelOverrides = {};

export function restoreBlockbenchPreviewModelOverrides(overrides) {
	previewModelOverrides = overrides && typeof overrides === 'object' ? { ...overrides } : {};
}

export function setBlockbenchPreviewModelEnabled(id, enabled) {
	const model = typeof PreviewModel !== 'undefined' ? PreviewModel.models?.[id] : null;
	const nativeEnabled = !!(model && PreviewModel.getActiveModels?.().includes(model));
	if (!!enabled === nativeEnabled) delete previewModelOverrides[id];
	else previewModelOverrides[id] = !!enabled;
	if (enabled && model && !model.enabled) model.update?.();
	return { ...previewModelOverrides };
}

function sceneOwnedModels() {
	return new Set(
		Object.values(typeof PreviewScene !== 'undefined' ? PreviewScene.scenes || {} : {})
			.flatMap(item => item.preview_models || [])
	);
}

export function listBlockbenchPreviewModels() {
	const owned = sceneOwnedModels();
	const active = new Set(typeof PreviewModel !== 'undefined' && PreviewModel.getActiveModels
		? PreviewModel.getActiveModels() : []);
	return Object.values(typeof PreviewModel !== 'undefined' ? PreviewModel.models || {} : {})
		.filter(model => !model.internal && !owned.has(model) && model.model_3d?.isObject3D)
		.map(model => ({ id: model.id, name: model.name || model.id,
			enabled: Object.hasOwn(previewModelOverrides, model.id) ? !!previewModelOverrides[model.id] : active.has(model) }));
}

function registeredScene(id) {
	return typeof PreviewScene !== 'undefined' ? PreviewScene.scenes?.[id] || null : null;
}

export function restoreBlockbenchSceneSelection(id) {
	selectedSceneId = registeredScene(id)?.id || '';
	return activeBlockbenchScene();
}

async function prepareScene(scene) {
	if (scene.require_minecraft_eula) {
		if (typeof MinecraftEULA === 'undefined' || !await MinecraftEULA.promptUser('preview_scenes')) return false;
	}
	if (!scene.loaded && scene.lazyLoadFromWeb) {
		try { await scene.lazyLoadFromWeb(); }
		catch (err) { scene.loaded = false; throw err; }
	}
	for (const model of scene.preview_models || []) {
		if (!model.enabled) model.update?.();
	}
	return true;
}

function cubeFace(direction) {
	const [x, y, z] = direction;
	const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
	if (ax >= ay && ax >= az) return x > 0 ? [0, -z / ax, -y / ax] : [1, z / ax, -y / ax];
	if (ay >= ax && ay >= az) return y > 0 ? [2, x / ay, z / ay] : [3, x / ay, -z / ay];
	return z > 0 ? [4, x / az, -y / az] : [5, -x / az, -y / az];
}

export function cubemapToEquirect(cubemap, width = 512, height = 256) {
	const faces = cubemap && cubemap.image;
	if (!Array.isArray(faces) || faces.length !== 6) return null;
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
	for (let y = 0; y < height; y++) {
		const latitude = Math.PI * (0.5 - (y + 0.5) / height);
		for (let x = 0; x < width; x++) {
			const longitude = 2 * Math.PI * ((x + 0.5) / width - 0.5);
			const direction = [Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude)];
			const [index, u, v] = cubeFace(direction);
			const face = faceData[index];
			const fx = Math.max(0, Math.min(face.width - 1, Math.floor((u + 1) * 0.5 * face.width)));
			const fy = Math.max(0, Math.min(face.height - 1, Math.floor((v + 1) * 0.5 * face.height)));
			const source = (fy * face.width + fx) * 4;
			const destination = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel++) data[destination + channel] = srgbToLinear(face.data[source + channel] / 255);
			data[destination + 3] = 1;
		}
	}
	return { width, height, data };
}

function cubemapReady(cubemap) {
	const faces = cubemap?.image;
	return Array.isArray(faces) && faces.length === 6 && Array.from({ length: 6 }, (_, index) => faces[index]).every(face => {
		const image = face?.image || face;
		return image && image.width > 0 && image.height > 0
			&& (!('complete' in image) || (image.complete && image.naturalWidth > 0));
	});
}

async function waitForCubemap(cubemap, timeout = 15000) {
	const deadline = Date.now() + timeout;
	while (!cubemapReady(cubemap)) {
		if (Date.now() >= deadline) throw new Error('Blockbench 场景立方体贴图加载超时');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

export async function loadBlockbenchScene(id) {
	const scene = registeredScene(id);
	if (!scene) return null;
	if (!await prepareScene(scene)) return null;
	if (!scene.cubemap) return { cubemap: null, environment: null };
	const cubemap = scene.cubemap;
	await waitForCubemap(cubemap);
	if (!convertedCubemaps.has(cubemap)) convertedCubemaps.set(cubemap, cubemapToEquirect(cubemap));
	return { cubemap, environment: convertedCubemaps.get(cubemap) };
}

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

export function listBlockbenchScenes() {
	if (typeof PreviewScene === 'undefined') return [];
	return Object.values(PreviewScene.scenes || {}).map(scene => ({
		id: scene.id,
		name: scene.name || scene.id,
		category: scene.category || 'other',
	}));
}

export function activeBlockbenchScene() {
	return registeredScene(selectedSceneId);
}

export async function selectBlockbenchScene(id) {
	if (!id) { selectedSceneId = ''; return true; }
	const scene = registeredScene(id);
	if (!scene) return false;
	if (!await prepareScene(scene)) return false;
	selectedSceneId = id;
	return true;
}
