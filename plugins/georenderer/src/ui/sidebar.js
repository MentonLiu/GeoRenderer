import { buildTabs, card, rowCheck, rowColor, rowNumber, rowSelect, rowSlider, rowText, syncControls } from './controls.js';
import { el } from './dom.js';
import { loadEnvFile } from './io.js';
import { showError } from './render-loop.js';
import { PTR, SKY_PRESETS, saveSettings } from './state.js';

export function buildSidebar() {
	PTR.controls = [];

	const renderCards = [
		card('分辨率与采样', 'photo_size_select_large', [
			rowSelect('分辨率', 'res_mode', { fit: '自适应窗口', custom: '自定义' }),
			rowNumber('宽度', 'res_width', 32, 8192, 1),
			rowNumber('高度', 'res_height', 32, 8192, 1),
			rowSelect('当前模式', 'render_mode', { preview: '预览（低采样）', final: '成片渲染' }),
			rowNumber('预览采样数', 'preview_samples', 1, 100000, 1),
			rowNumber('成片采样数', 'final_samples', 1, 100000, 1),
			el('div', { class: 'ptr_note', text: '调试时可以使用预览模式，渲染速度更快。确认效果后切到“成片渲染”获取更清晰的图片。' }),
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
			rowCheck('线性过滤纹理', 'filter_linear'),
			rowCheck('自动重载模型', 'auto_follow'),
		]),
	];

	const camBtns = el('div', { class: 'ptr_presets' });
	const btnSync = el('button', { class: 'ptr_btn', text: '同步主视图' });
	btnSync.addEventListener('click', () => {
		if (PTR.cam.syncFromPreview()) {
			PTR.settings.fov = PTR.cam.fov;
			PTR.settings.ortho = PTR.cam.ortho;
			syncControls();
			if (PTR.tracer) PTR.tracer.reset();
		}
	});
	const btnFrame = el('button', { class: 'ptr_btn', text: '框选模型' });
	btnFrame.addEventListener('click', () => {
		if (PTR.tracer && PTR.tracer.scene) PTR.cam.frameBounds(PTR.tracer.scene.bounds);
		if (PTR.tracer) PTR.tracer.reset();
	});
	camBtns.appendChild(btnSync);
	camBtns.appendChild(btnFrame);

	const cameraCards = [
		card('相机', 'videocam', [
			camBtns,
			rowCheck('正交投影', 'ortho'),
			rowSlider('FOV', 'fov', 5, 120, 1, 0),
			rowCheck('自动跟随主视图', 'auto_sync'),
		]),
		card('景深', 'filter_center_focus', [
			rowSlider('光圈', 'aperture', 0, 8, 0.05, 2),
			rowCheck('自动对焦', 'auto_focus'),
			rowNumber('对焦距离', 'focus_distance', 0, 10000, 0.5),
		]),
	];

	const presets = el('div', { class: 'ptr_presets' });
	Object.keys(SKY_PRESETS).forEach(name => {
		const b = el('button', { class: 'ptr_btn', text: name });
		b.addEventListener('click', () => {
			Object.assign(PTR.settings, SKY_PRESETS[name]);
			syncControls();
			saveSettings();
			try {
				if (PTR.tracer) {
					PTR.tracer.setEnvironment(PTR.settings, PTR.customEnv);
					PTR.tracer.reset();
				}
			} catch (err) { showError(err); }
		});
		presets.appendChild(b);
	});

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
		PTR.customEnv = null;
		PTR.customEnvName = '';
		PTR.nodes.envName.textContent = '(未载入)';
		if (PTR.settings.env_mode === 'image') { PTR.settings.env_mode = 'sky'; syncControls(); }
		try { if (PTR.tracer) PTR.tracer.setEnvironment(PTR.settings, null); } catch (err) { showError(err); }
	});
	envBtns.appendChild(btnLoad);
	envBtns.appendChild(btnClear);
	PTR.nodes.envName = el('span', { class: 'ptr_note', text: '(未载入)' });

	const envCards = [
		card('环境光', 'wb_sunny', [
			presets,
			rowSelect('环境类型', 'env_mode', { sky: '程序化天空', gradient: '渐变', solid: '纯色', image: 'HDR / 图片' }),
			envBtns,
			PTR.nodes.envName,
			rowSlider('环境强度', 'env_intensity', 0, 20, 0.05, 2),
			rowSlider('环境旋转', 'env_rotation', -180, 180, 1, 0),
			rowSelect('背景', 'bg_mode', { env: '显示环境', color: '纯色', transparent: '透明' }),
			rowColor('背景颜色', 'bg_color'),
		]),
		card('太阳', 'brightness_high', [
			rowCheck('启用太阳', 'sun_enable'),
			rowSlider('太阳高度', 'sun_elevation', -10, 90, 0.5, 1),
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
			rowSlider('粗糙度', 'ground_rough', 0.02, 1, 0.01, 2),
			rowSlider('金属度', 'ground_metal', 0, 1, 0.01, 2),
			rowNumber('半径（0=无限）', 'ground_radius', 0, 100000, 1),
			el('div', { class: 'ptr_note', text: '阴影捕捉模式下地面本身不着色，只在背景中输出阴影的 alpha，配合“背景=透明”可导出带投影的透明 PNG' }),
		]),
	];

	PTR.nodes.matlist = el('div', { id: 'ptr_matlist' });
	const materialCards = [
		card('材质默认值', 'palette', [
			rowSlider('默认粗糙度', 'def_roughness', 0, 1, 0.01, 2),
			rowSlider('默认金属度', 'def_metalness', 0, 1, 0.01, 2),
			rowSlider('自发光强度', 'emissive_strength', 0, 40, 0.1, 2),
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
	];

	const postCards = [
		card('色调映射', 'tune', [
			rowSelect('色调映射', 'tone_mapping', { none: '无', reinhard: 'Reinhard', aces: 'ACES', filmic: 'Filmic', agx: 'AgX' }),
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

	return buildTabs([
		{ title: '渲染', icon: 'speed', cards: renderCards },
		{ title: '相机', icon: 'videocam', cards: cameraCards },
		{ title: '环境', icon: 'wb_sunny', cards: envCards },
		{ title: '材质', icon: 'palette', cards: materialCards },
		{ title: '后期', icon: 'tune', cards: postCards },
	]);
}
