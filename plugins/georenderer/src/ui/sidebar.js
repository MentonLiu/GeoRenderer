import { buildStages, card, makeRow, rowCheck, rowColor, rowNumber, rowSelect, rowSlider, rowText, syncControls } from './controls.js';
import { el } from './dom.js';
import { loadEnvFile } from './io.js';
import { buildGroupList } from './group-panel.js';
import { buildMaterialList } from './material-panel.js';
import { rebuildScene, showError } from './render-loop.js';
import { PTR, saveSettings } from './state.js';
import { SCENE_PRESETS, formatClock } from '../scene/presets.js';
import { generateSkyPixels } from '../scene/environment.js';
import { activeBlockbenchScene, getBlockbenchScene, listBlockbenchPreviewModels, listBlockbenchScenes, loadBlockbenchScene, selectBlockbenchScene, setBlockbenchPreviewModelEnabled } from '../scene/blockbench-scene.js';
import { buildExportPanel, updateExportSummary } from './export-panel.js';

function makeGroundTextureRow() {
	const select = el('select');
	PTR.refreshGroundTextures = () => {
		select.replaceChildren(el('option', { value: '', text: '纯色地面' }));
		for (const texture of (typeof Texture !== 'undefined' && Texture.all) || []) {
			select.appendChild(el('option', { value: texture.uuid, text: texture.name || texture.uuid }));
		}
		select.value = PTR.settings.ground_texture_uuid || '';
	};
	PTR.refreshGroundTextures();
	select.addEventListener('change', () => {
		PTR.settings.ground_texture_uuid = select.value;
		saveSettings();
		if (PTR.raster) PTR.raster.setGroundTexture(((typeof Texture !== 'undefined' && Texture.all) || []).find(texture => texture.uuid === select.value));
		if (PTR.tracer) rebuildScene();
	});
	return makeRow('地面纹理', [select]);
}

export async function syncBlockbenchScene() {
	const request = ++PTR.scenePresetRequest;
	const scene = activeBlockbenchScene();
	PTR.refreshPreviewScenes?.();
	if (PTR.nodes.sceneSource) PTR.nodes.sceneSource.textContent = scene ? `正在读取「${scene.name}」的场景模型…` : '未选择 Blockbench 场景模型';
	if (scene && !await selectBlockbenchScene(scene.id)) {
		if (request === PTR.scenePresetRequest && PTR.nodes.sceneSource) PTR.nodes.sceneSource.textContent = '场景模型未能加载，请检查场景资源或 Minecraft EULA 状态';
		return;
	}
	if (request !== PTR.scenePresetRequest) return;
	PTR.settings.scene_preset = scene?.id || '';
	PTR.refreshPreviewModels?.();
	if (PTR.nodes.sceneSource) PTR.nodes.sceneSource.textContent = scene
		? `使用「${scene.name}」的 ${scene.preview_models?.length || 0} 个 3D 场景模型`
		: '未选择 Blockbench 场景模型';
	if (PTR.tracer) rebuildScene();
	updateExportSummary();
	saveSettings();
}

export async function syncBlockbenchBackground() {
	const request = ++PTR.backgroundPresetRequest;
	const scene = getBlockbenchScene(PTR.settings.background_preset);
	const previousEnv = PTR.customEnv;
	const previousMode = PTR.settings.env_mode;
	PTR.refreshPreviewBackgrounds?.();
	if (PTR.nodes.backgroundSource) PTR.nodes.backgroundSource.textContent = scene ? `正在读取「${scene.name}」的背景…` : '使用下方设置的 GeoRenderer 环境或自定义图片';
	try {
		const loaded = scene && PTR.customEnvSource !== 'file' ? await loadBlockbenchScene(scene.id, { includeModels: false }) : null;
		if (request !== PTR.backgroundPresetRequest) return;
		if (scene && PTR.customEnvSource !== 'file' && !loaded) throw new Error('背景未能加载，请检查 Minecraft EULA 状态');
		// Blockbench's studio has no skybox; give its independent background a neutral studio gradient.
		if (loaded && !loaded.environment && scene.id === 'studio') {
			loaded.environment = { width: 512, height: 256, data: generateSkyPixels({ ...PTR.settings, ...SCENE_PRESETS.studio, day_cycle: false, sun_enable: false }, 512, 256) };
		}
		PTR.backgroundScene = loaded ? scene : null;
		PTR.sceneCubemap = loaded?.cubemap || null;
		if (loaded?.environment) {
			PTR.customEnv = loaded.environment;
			PTR.customEnvName = scene.name;
			PTR.customEnvSource = 'scene';
			PTR.settings.env_mode = 'image';
		} else if (PTR.customEnvSource !== 'file' && (PTR.customEnv || PTR.settings.env_mode === 'image')) {
			PTR.customEnv = null;
			PTR.customEnvName = '';
			PTR.customEnvSource = '';
			PTR.settings.env_mode = 'sky';
		}
		if (PTR.nodes.backgroundSource) {
			PTR.nodes.backgroundSource.textContent = loaded?.environment
				? `使用「${scene.name}」的${loaded.cubemap ? '天空盒' : '渐变背景'}，用于背景、环境光和反射`
				: scene ? `「${scene.name}」未提供背景贴图，使用 GeoRenderer 环境` : '使用下方设置的 GeoRenderer 环境或自定义图片';
		}
	} catch (err) {
		if (request !== PTR.backgroundPresetRequest) return;
		PTR.backgroundScene = null;
		PTR.sceneCubemap = null;
		if (PTR.customEnvSource !== 'file' && (PTR.customEnv || PTR.settings.env_mode === 'image')) {
			PTR.customEnv = null;
			PTR.customEnvName = '';
			PTR.customEnvSource = '';
			PTR.settings.env_mode = 'sky';
		}
		if (PTR.nodes.backgroundSource) PTR.nodes.backgroundSource.textContent = `「${scene?.name || '所选背景'}」加载失败：${err.message}`;
	}
	if (PTR.nodes.envName) PTR.nodes.envName.textContent = PTR.customEnv
		? `${PTR.customEnvName}（${PTR.customEnvSource === 'scene' ? '背景预设' : '自定义文件'}）`
		: '(未载入)';
	syncControls();
	try {
		if (previousEnv !== PTR.customEnv || previousMode !== PTR.settings.env_mode) {
			if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
			else if (PTR.tracer) PTR.needsRebuild = true;
		}
	} catch (err) { showError(err); }
	updateExportSummary();
	saveSettings();
}

export function buildSidebar() {
	PTR.controls = [];

	const resolutionCard = card('成片尺寸', 'photo_size_select_large', [
			rowSelect('分辨率', 'res_mode', { fit: '自适应窗口', custom: '自定义' }),
			rowNumber('宽度', 'res_width', 32, 8192, 1),
			rowNumber('高度', 'res_height', 32, 8192, 1),
			el('div', { class: 'ptr_note', text: '画面左侧按最终长宽比取景；最终渲染使用这里的尺寸。' }),
		]);
	const renderCards = [
		card('预览质量', 'preview', [
			rowSlider('预览比例', 'preview_scale', 0.25, 1, 0.05, 2),
			rowNumber('预览采样数', 'preview_samples', 1, 100000, 1),
			el('div', { class: 'ptr_note', text: '预览使用缩小后的目标尺寸；进入最终渲染时恢复成片尺寸。' }),
		]),
		card('光线追踪', 'call_split', [
			rowSlider('最大反弹', 'max_bounce', 1, 16, 1, 0),
			rowSlider('光源采样数', 'light_samples', 1, 16, 1, 0),
			el('div', { class: 'ptr_note', text: '每次反弹对灯光/太阳/环境光多次采样取平均，可显著降低噪点，但会增加相应倍数的渲染开销。' }),
			rowSlider('亮度截断', 'clamp_value', 0, 100, 0.5, 1),
			el('div', { class: 'ptr_note', text: '亮度截断可抑制萤火虫噪点，设为 0 表示关闭（更物理准确但收敛更慢）' }),
		]),
		card('性能', 'speed', [
			rowSlider('交互降采样', 'interactive_scale', 0.2, 1, 0.05, 2),
			rowSelect('GPU 模式', 'gpu_profile', { auto: '自动检测', apple: 'Apple GPU', standard: '标准' }),
			el('div', { class: 'ptr_note', text: '自动检测不到 Apple GPU 时，可手动选择 Apple GPU。该模式优化拖动预览和全屏渲染缓冲。' }),
			rowCheck('平滑纹理（线性过滤）', 'filter_linear'),
			el('div', { class: 'ptr_note', text: '像素风格贴图建议关闭平滑纹理，以保留清晰的像素边界。' }),
			rowCheck('自动重载模型', 'auto_follow'),
		]),
	];

	const camBtns = el('div', { class: 'ptr_presets' });
	const btnSync = el('button', { class: 'ptr_btn', text: '同步主视图' });
	btnSync.addEventListener('click', () => {
		if (PTR.cam.syncFromPreview()) {
			PTR.settings.fov = PTR.cam.fov;
			PTR.settings.ortho = PTR.cam.ortho;
			PTR.settings.camera_distance = PTR.cam.distance;
			syncControls();
			saveSettings();
			if (PTR.tracer) PTR.tracer.reset();
		}
	});
	const btnFrame = el('button', { class: 'ptr_btn', text: '框选模型' });
	btnFrame.addEventListener('click', () => {
		if (PTR.tracer && PTR.tracer.scene) PTR.cam.frameBounds(PTR.tracer.scene.bounds);
		else if (PTR.raster && PTR.raster.model) {
			const bounds = new THREE.Box3().setFromObject(PTR.raster.model);
			if (!bounds.isEmpty()) {
				const center = bounds.getCenter(new THREE.Vector3());
				const size = bounds.getSize(new THREE.Vector3());
				PTR.cam.frameBounds({ center: center.toArray(), radius: size.length() / 2 });
			}
		}
		if (PTR.tracer) PTR.tracer.reset();
		PTR.settings.camera_distance = PTR.cam.distance;
		syncControls();
		saveSettings();
	});
	camBtns.appendChild(btnSync);
	camBtns.appendChild(btnFrame);

	const cameraCards = [
		card('取景说明', 'lock', [
			el('div', { class: 'ptr_note', text: '在左侧拖动、平移或缩放来确定镜头。进入第 4 步后镜头位置固定；要修改镜头请返回本步。' }),
		]),
		card('相机', 'videocam', [
			camBtns,
			rowCheck('正交投影', 'ortho'),
			rowSlider('FOV', 'fov', 5, 120, 1, 0),
			rowSlider('镜头距离', 'camera_distance', 0.5, 2000, 0.5, 1),
			rowCheck('自动跟随主视图', 'auto_sync'),
		]),
		card('景深', 'filter_center_focus', [
			rowSlider('光圈', 'aperture', 0, 8, 0.05, 2),
			rowCheck('自动对焦', 'auto_focus'),
			rowNumber('对焦距离', 'focus_distance', 0, 10000, 0.5),
		]),
	];

	const sceneSelect = el('select', { 'aria-label': '场景（地面）' });
	PTR.refreshPreviewScenes = () => {
		const active = activeBlockbenchScene();
		sceneSelect.replaceChildren(el('option', { value: '', text: '无预览场景' }));
		for (const scene of listBlockbenchScenes()) {
			sceneSelect.appendChild(el('option', { value: scene.id, text: scene.name }));
		}
		sceneSelect.value = active?.id || '';
	};
	PTR.refreshPreviewScenes();
	const backgroundSelect = el('select', { 'aria-label': '背景预设' });
	PTR.refreshPreviewBackgrounds = () => {
		backgroundSelect.replaceChildren(el('option', { value: '', text: 'GeoRenderer 环境 / 自定义图片' }));
		for (const scene of listBlockbenchScenes()) {
			backgroundSelect.appendChild(el('option', { value: scene.id, text: scene.name }));
		}
		backgroundSelect.value = PTR.settings.background_preset || '';
	};
	PTR.refreshPreviewBackgrounds();
	backgroundSelect.addEventListener('change', async () => {
		backgroundSelect.disabled = true;
		PTR.settings.background_preset = backgroundSelect.value;
		PTR.customEnvSource = '';
		try { await syncBlockbenchBackground(); }
		catch (err) { showError(err); }
		finally {
			backgroundSelect.disabled = false;
			if (PTR.dialog?.object?.isConnected) PTR.dialog.focus();
		}
	});
	const previewModelList = el('div', { class: 'ptr_preview_model_list' });
	PTR.refreshPreviewModels = () => {
		previewModelList.replaceChildren();
		const models = listBlockbenchPreviewModels();
		if (!models.length) {
			previewModelList.appendChild(el('div', { class: 'ptr_note', text: '没有可用的独立参照模型' }));
			return;
		}
		for (const model of models) {
			const box = el('input', { type: 'checkbox', 'aria-label': model.name });
			box.checked = model.enabled;
			box.addEventListener('change', () => {
				PTR.settings.preview_model_overrides = setBlockbenchPreviewModelEnabled(model.id, box.checked);
				if (PTR.tracer) rebuildScene();
				saveSettings();
			});
			previewModelList.appendChild(makeRow(model.name, [box]));
		}
	};
	PTR.refreshPreviewModels();
	sceneSelect.addEventListener('change', async () => {
		sceneSelect.disabled = true;
		try {
			if (!await selectBlockbenchScene(sceneSelect.value)) {
				PTR.nodes.sceneSource.textContent = '预览场景未能加载，请检查场景资源或 Minecraft EULA 状态';
				PTR.refreshPreviewScenes();
				return;
			}
			await syncBlockbenchScene();
		} catch (err) {
			showError(err);
			PTR.refreshPreviewScenes();
		} finally {
			sceneSelect.disabled = false;
			if (PTR.dialog?.object?.isConnected) PTR.dialog.focus();
		}
	});
	const refreshScenes = el('button', { class: 'ptr_btn', text: '刷新场景列表' });
	refreshScenes.addEventListener('click', () => {
		PTR.refreshPreviewScenes();
		PTR.refreshPreviewBackgrounds();
		syncBlockbenchScene().catch(showError);
		syncBlockbenchBackground().catch(showError);
	});
	PTR.nodes.sceneSource = el('div', { class: 'ptr_note', text: '读取场景模型…' });
	PTR.nodes.backgroundSource = el('div', { class: 'ptr_note', text: '读取背景预设…' });
	PTR.nodes.timeDisplay = el('strong', { class: 'ptr_time', text: formatClock(PTR.settings.time_of_day) });

	const envFile = el('input', { type: 'file', accept: '.hdr,.png,.jpg,.jpeg,.webp', style: { display: 'none' } });
	envFile.addEventListener('change', () => {
		const f = envFile.files && envFile.files[0];
		if (f) loadEnvFile(f);
		envFile.value = '';
	});
	const envBtns = el('div', { class: 'ptr_presets' }, [envFile]);
	const btnLoad = el('button', { class: 'ptr_btn', text: '载入 HDR / 图片' });
	btnLoad.addEventListener('click', () => envFile.click());
	const btnClear = el('button', { class: 'ptr_btn', text: '清除' });
	btnClear.addEventListener('click', () => {
		PTR.backgroundPresetRequest++;
		PTR.customEnv = null;
		PTR.customEnvName = '';
		PTR.customEnvSource = '';
		PTR.sceneCubemap = null;
		PTR.backgroundScene = null;
		PTR.settings.background_preset = '';
		PTR.refreshPreviewBackgrounds();
		PTR.nodes.backgroundSource.textContent = '使用下方设置的 GeoRenderer 环境或自定义图片';
		PTR.nodes.envName.textContent = '(未载入)';
		if (PTR.settings.env_mode === 'image') { PTR.settings.env_mode = 'sky'; syncControls(); }
		try {
			if (PTR.tracer && PTR.open) PTR.tracer.setEnvironment(PTR.settings, null);
			else if (PTR.tracer) PTR.needsRebuild = true;
		} catch (err) { showError(err); }
		updateExportSummary();
		saveSettings();
	});
	envBtns.appendChild(btnLoad);
	envBtns.appendChild(btnClear);
	PTR.nodes.envName = el('span', { class: 'ptr_note', text: '(未载入)' });

	const envCards = [
		card('场景与背景', 'public', [
			makeRow('场景（地面）', [sceneSelect]),
			makeRow('背景预设', [backgroundSelect]),
			refreshScenes,
			PTR.nodes.sceneSource,
			PTR.nodes.backgroundSource,
			el('div', { class: 'ptr_note', text: '场景与背景独立选择，例如“平原地面 + 工作室背景”或“平原地面 + 下界背景”。这些设置只应用于 GeoRenderer。' }),
			el('div', { class: 'ptr_note', text: '第 3～5 步沿用此组合；第 4、5 步追踪所选场景的几何与纹理，并使用所选背景的环境光。有场景几何时自动隐藏额外的 GeoRenderer 地面。' }),
		]),
		card('时间', 'schedule', [
			rowSlider('当前时间', 'time_of_day', 0, 24, 0.25, 2),
			PTR.nodes.timeDisplay,
			rowCheck('联动环境昼夜', 'day_cycle'),
			el('div', { class: 'ptr_note', text: '00:00 / 24:00 为午夜，06:00 日出，12:00 正午，18:00 日落。联动时，天空、背景图片、环境照明和雾一起变化；晨昏偏暖，夜间偏冷。关闭后可保留 HDR / 工作室的固定环境光。' }),
		]),
		card('独立参照模型', 'accessibility_new', [
			previewModelList,
			el('div', { class: 'ptr_note', text: '这些开关只影响 GeoRenderer 预览和渲染，不改变 Blockbench 主视图。' }),
		]),
		card('环境光', 'wb_sunny', [
			rowSelect('环境类型', 'env_mode', { sky: '程序化天空', gradient: '渐变', solid: '纯色', image: '背景预设 / HDR / 图片' }),
			envBtns,
			PTR.nodes.envName,
			rowSlider('环境强度', 'env_intensity', 0, 20, 0.05, 2),
			rowSlider('环境旋转', 'env_rotation', -180, 180, 1, 0),
			rowSelect('背景显示', 'bg_mode', { env: '显示环境', color: '纯色', transparent: '透明' }),
			rowColor('背景颜色', 'bg_color'),
		]),
		card('太阳', 'brightness_high', [
			rowCheck('启用太阳', 'sun_enable'),
			rowSlider('太阳高度', 'sun_elevation', -90, 90, 0.5, 1),
			rowSlider('太阳方位', 'sun_azimuth', 0, 360, 1, 0),
			rowSlider('太阳角直径', 'sun_angle', 0.25, 45, 0.05, 2),
			rowSlider('太阳强度', 'sun_intensity', 0, 40, 0.1, 2),
			rowColor('太阳颜色', 'sun_color'),
		]),
		card('天空颜色', 'gradient', [
			rowColor('天顶色', 'sky_zenith'),
			rowColor('地平线色', 'sky_horizon'),
			rowColor('地面色', 'sky_ground'),
			rowSlider('雾霾', 'sky_haze', 0, 1, 0.01, 2),
			rowColor('渐变-上', 'grad_top'),
			rowColor('渐变-下', 'grad_bottom'),
			rowColor('纯色环境', 'solid_color'),
		]),
		card('地面', 'landscape', [
			rowCheck('启用地面', 'ground_on'),
			rowCheck('阴影捕捉（透明）', 'ground_catcher'),
			rowNumber('地面高度', 'ground_y', -1000, 1000, 0.5),
			rowColor('颜色', 'ground_color'),
			makeGroundTextureRow(),
			rowSlider('纹理尺寸', 'ground_texture_scale', 0.25, 64, 0.25, 2),
			rowSlider('粗糙度', 'ground_rough', 0.02, 1, 0.01, 2),
			rowSlider('金属度', 'ground_metal', 0, 1, 0.01, 2),
			rowNumber('半径（0=无限）', 'ground_radius', 0, 100000, 1),
			el('div', { class: 'ptr_note', text: '阴影捕捉模式下地面本身不着色，只在背景中输出阴影的 alpha，配合“背景=透明”可导出带投影的透明 PNG' }),
		]),
	];

	PTR.nodes.matlist = el('div', { id: 'ptr_matlist' });
	PTR.nodes.groupList = el('div', { id: 'ptr_grouplist' });
	PTR.nodes.groupInspector = el('div', { id: 'ptr_groupinspector' });
	const materialSettings = el('div', { class: 'ptr_material_settings' }, [
		card('选中组的渲染参数', 'tune', [PTR.nodes.groupInspector]),
		card('材质默认值', 'palette', [
			rowSlider('默认粗糙度', 'def_roughness', 0, 1, 0.01, 2),
			rowSlider('默认金属度', 'def_metalness', 0, 1, 0.01, 2),
			rowSlider('纹理自发光倍率', 'emissive_strength', 0, 40, 0.1, 2),
			el('div', { class: 'ptr_note', text: '倍率控制纹理原有的自发光；部位的自发光强度独立生效，设为 0 可关闭该部位发光。' }),
			rowSelect('渲染面', 'render_sides', { auto: '跟随 Blockbench', double: '强制双面', front: '强制单面' }),
			el('div', { class: 'ptr_note', text: '跟随 Blockbench 时会按格式/纹理做背面剔除（Java 方块模型为单面），负尺寸方块因此只显示内部贴图，与视图一致。' }),
			rowSelect('Alpha 模式', 'alpha_mode', { cutout: '裁剪（Minecraft）', blend: '混合（半透明）', opaque: '忽略透明' }),
			rowSlider('默认 Alpha 阈值', 'alpha_cutoff', 0, 1, 0.01, 2),
			el('div', { class: 'ptr_note', text: '裁剪: alpha 低于阈值的像素完全不可见(树叶/栅栏)。混合: 按 alpha 随机穿透，可渲染染色玻璃等半透明材质。' }),
			el('div', { class: 'ptr_note', text: '带 MER 通道的材质组会自动使用金属/自发光/粗糙贴图；纹理“发光”渲染模式会被当作自发光光源。' }),
		]),
		card('逐纹理覆盖', 'texture_add', [
			PTR.nodes.matlist,
		]),
	]);
	PTR.nodes.materialSettings = materialSettings;
	const outlineCard = card('模型组大纲', 'account_tree', [
		el('div', { class: 'ptr_note', text: '文件夹表示模型组；点击左侧模型也会定位到对应组。' }),
		PTR.nodes.groupList,
	]);
	outlineCard.classList.add('ptr_material_outline');
	const materialCards = [materialSettings, outlineCard];

	const postCards = [
		card('背景清晰度', 'blur_on', [
			rowSlider('背景模糊度', 'background_blur', 0, 100, 1, 0),
			el('div', { class: 'ptr_note', text: '0 保留背景贴图的清晰度，数值越大越柔化。用于预览与最终渲染的环境背景，不改变环境照明与材质反射。光圈仍会产生景深虚化。' }),
		]),
		card('色调映射', 'tune', [
			rowSelect('色调映射', 'tone_mapping', { none: '无', reinhard: 'Reinhard', aces: 'ACES', filmic: 'Filmic', agx: 'AgX' }),
			el('div', { class: 'ptr_note', text: '观察反射和自发光时建议使用 ACES 或 AgX。“无”会截断过亮的高光，容易让不同材质看起来都一样亮。' }),
			rowSlider('曝光', 'exposure', 0.05, 8, 0.01, 2),
			rowSlider('对比度', 'contrast', 0.2, 3, 0.01, 2),
			rowSlider('饱和度', 'saturation', 0, 3, 0.01, 2),
		]),
		card('降噪', 'blur_linear', [
			rowCheck('降噪', 'denoise'),
			rowSlider('降噪强度', 'denoise_strength', 0, 8, 0.05, 2),
		]),
		card('后处理效果', 'star', [
			rowCheck('泛光 Bloom', 'bloom_enable'),
			rowSlider('泛光阈值', 'bloom_threshold', 0, 10, 0.05, 2),
			rowSlider('泛光强度', 'bloom_intensity', 0, 5, 0.01, 2),
			rowSlider('泛光半径', 'bloom_radius', 0.2, 10, 0.1, 1),
			rowCheck('暗角 Vignette', 'vignette_enable'),
			rowSlider('暗角强度', 'vignette_strength', 0, 1.5, 0.01, 2),
			rowCheck('锐化 Sharpen', 'sharpen_enable'),
			rowSlider('锐化强度', 'sharpen_strength', 0, 2, 0.01, 2),
			rowCheck('胶片颗粒', 'grain_enable'),
			rowSlider('颗粒强度', 'grain_strength', 0, 0.3, 0.005, 3),
		]),
		card('水印', 'text_format', [
			rowCheck('启用水印', 'watermark_enable'),
			rowText('水印文本', 'watermark_text', '例如：© 你的名字'),
			rowSlider('字号', 'watermark_size', 8, 96, 1, 0),
			rowSlider('不透明度', 'watermark_opacity', 0, 1, 0.01, 2),
			rowColor('颜色', 'watermark_color'),
			el('div', { class: 'ptr_note', text: '水印会显示在画面左下角，并包含在“保存 PNG”导出的图片中。' }),
		]),
	];

	const stages = buildStages([
		{ id: 'materials', cards: materialCards },
		{ id: 'scene', cards: envCards },
		{ id: 'camera', cards: [resolutionCard, ...cameraCards] },
		{ id: 'preview', cards: [...renderCards, ...postCards] },
		{ id: 'export', cards: buildExportPanel() },
	]);
	buildGroupList();
	buildMaterialList();
	updateExportSummary();
	return stages;
}
