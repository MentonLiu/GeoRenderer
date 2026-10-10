import { DEFAULTS } from '../core/config.js';
import { OrbitCam } from './orbit-camera.js';

const STORAGE_KEY = 'pathtracer_preview_settings';

export const CHANGE_KIND = {
	def_roughness: 'scene', def_metalness: 'scene', emissive_strength: 'scene',
	ground_texture_uuid: 'scene', ground_texture_scale: 'reset',
	background_blur: 'reset',
	time_of_day: 'env',
	day_cycle: 'env',
	alpha_cutoff: 'scene', alpha_mode: 'scene', render_sides: 'scene',
	env_mode: 'env', sun_enable: 'env', sun_elevation: 'env', sun_azimuth: 'env',
	sun_intensity: 'env', sun_color: 'env', sky_zenith: 'env', sky_horizon: 'env',
	sky_ground: 'env', sky_haze: 'env', grad_top: 'env', grad_bottom: 'env', solid_color: 'env',
	tone_mapping: 'post', exposure: 'post', contrast: 'post', saturation: 'post',
	denoise: 'post', denoise_strength: 'post',
	bloom_enable: 'post', bloom_threshold: 'post', bloom_intensity: 'post', bloom_radius: 'post',
	vignette_enable: 'post', vignette_strength: 'post',
	sharpen_enable: 'post', sharpen_strength: 'post',
	grain_enable: 'post', grain_strength: 'post',
	watermark_enable: 'post', watermark_text: 'post', watermark_size: 'post',
	watermark_opacity: 'post', watermark_color: 'post',
	res_mode: 'resize', res_width: 'resize', res_height: 'resize', preview_scale: 'resize',
	render_mode: 'post', preview_samples: 'post', final_samples: 'post',
	auto_follow: 'post', auto_sync: 'post', interactive_scale: 'post',
	gpu_profile: 'post',
};

export const SKY_PRESETS = {
	'正午': { env_mode: 'sky', sun_enable: true, sun_elevation: 66, sun_azimuth: 140, sun_intensity: 6, sun_angle: 1.2, sun_color: '#fff6e8', sky_zenith: '#3c78c8', sky_horizon: '#c6dcf2', sky_ground: '#5a5a5e', sky_haze: 0.3, env_intensity: 1 },
	'黄昏': { env_mode: 'sky', sun_enable: true, sun_elevation: 7, sun_azimuth: 250, sun_intensity: 5, sun_angle: 2.0, sun_color: '#ff9a4d', sky_zenith: '#2b3f7a', sky_horizon: '#ffb27a', sky_ground: '#3a3238', sky_haze: 0.75, env_intensity: 1.1 },
	'阴天': { env_mode: 'sky', sun_enable: false, sun_intensity: 0, sky_zenith: '#b9c3cc', sky_horizon: '#dde3e8', sky_ground: '#6a6a6e', sky_haze: 1, env_intensity: 1.6 },
	'夜晚': { env_mode: 'sky', sun_enable: true, sun_elevation: 42, sun_azimuth: 300, sun_intensity: 0.35, sun_angle: 3, sun_color: '#c8d8ff', sky_zenith: '#080d1c', sky_horizon: '#16203a', sky_ground: '#0a0a10', sky_haze: 0.2, env_intensity: 1 },
	'影棚': { env_mode: 'gradient', sun_enable: true, sun_elevation: 35, sun_azimuth: 45, sun_intensity: 4, sun_angle: 12, sun_color: '#ffffff', grad_top: '#cfcfcf', grad_bottom: '#131316', env_intensity: 1, bg_mode: 'color', bg_color: '#1b1b20' },
};

export const PTR = {
	dialog: null,
	cameraInitialized: false,
	tracer: null,
	cam: new OrbitCam(),
	inspectionCam: new OrbitCam(),
	settings: Object.assign({}, DEFAULTS),
	overrides: {},
	groupOverrides: {},
	sceneCubemap: null,
	scenePresetRequest: 0,
	backgroundPresetRequest: 0,
	backgroundScene: null,
	customEnv: null,
	customEnvName: '',
	customEnvSource: '',
	open: false,
	paused: false,
	raf: 0,
	passesPerFrame: 1,
	lastFrame: 0,
	interacting: false,
	interactTimer: 0,
	nodes: {},
	controls: [],
	step: 'materials',
	lockedCamera: null,
	selectedGroupUuid: null,
	collapsedGroups: new Set(),
	finalStarted: false,
	finalRender: null,
	needsPresent: false,
	raster: null,
	refreshMaterialList: null,
	rebuildTimer: 0,
	autoFollow: false,
	stale: false,
	needsRebuild: false,
	lastPasses: 0,
	spsEma: 0,
};

// 将秒数格式化为界面使用的秒、分秒或时分文本。
export function formatDuration(sec) {
	if (!isFinite(sec) || sec < 0) return '--';
	if (sec < 90) return sec.toFixed(0) + 's';
	if (sec < 3600) return Math.floor(sec / 60) + 'm' + Math.round(sec % 60) + 's';
	return Math.floor(sec / 3600) + 'h' + Math.round((sec % 3600) / 60) + 'm';
}

// 从本地存储恢复设置和材质覆盖；单个损坏存档不会阻止插件启动。
export function loadSettings() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const data = JSON.parse(raw);
			// 只读取默认表声明的键，避免旧版本或外部字段污染运行时状态。
			for (const k in DEFAULTS) if (data[k] !== undefined) PTR.settings[k] = data[k];
			migrateBackgroundSelection(data);
			if (data.__overrides) PTR.overrides = data.__overrides;
			if (data.__groups) PTR.groupOverrides = data.__groups;
		}
	} catch (err) { }
}

// 将旧版本的 scene_preset 字段迁移到现在的 background_preset 字段。
export function migrateBackgroundSelection(data) {
	if (data.background_preset === undefined) PTR.settings.background_preset = data.scene_preset || '';
}

// 持久化设置及两类覆盖表，供下一次打开插件时恢复。
export function saveSettings() {
	try {
		const data = Object.assign({}, PTR.settings);
		data.__overrides = PTR.overrides;
		data.__groups = PTR.groupOverrides;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch (err) { }
}

// 延迟刷新栅格材质预览，合并短时间内连续发生的设置变更。
export function refreshRasterMaterials() {
	clearTimeout(PTR.rasterRefreshTimer);
	if (PTR.raster) PTR.rasterRefreshTimer = setTimeout(() => PTR.raster?.refreshModel(), 60);
}
