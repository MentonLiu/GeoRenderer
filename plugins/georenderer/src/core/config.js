

export const PLUGIN_ID = 'georenderer';

export const TRI_POS_TEXELS = 3;
export const TRI_ATTR_TEXELS = 4;
export const MAT_TEXELS = 5;
export const BVH_TEXELS = 2;
export const DATA_TEX_WIDTH = 1024;
export const MAX_LEAF_TRIS = 8;
export const SAH_BINS = 12;
export const ENV_W = 1024, ENV_H = 512;
export const MAX_ENV_IMAGE_SIZE = 4096;
export const MAX_RENDER_BUFFER_SIDE = 1024;
export const FINAL_TILE_SIDE = 768;
export const ENV_DIST_W = 256, ENV_DIST_H = 128;

export const INTERACTIVE_MAX_BOUNCE = 2;
export const INTERACTIVE_PASS_CAP = 8;
export const IDLE_PASS_CAP = 64;
export const FINAL_PASS_CAP = 4;

export const DEFAULTS = {
	res_mode: 'custom',
	res_width: 1280,
	res_height: 720,
	render_mode: 'preview',
	preview_samples: 8,
	preview_scale: 0.5,
	final_samples: 256,
	max_bounce: 6,
	light_samples: 1,
	clamp_value: 12,
	filter_linear: false,
	denoise: true,
	denoise_strength: 1.0,
	interactive_scale: 0.2,
	gpu_profile: 'auto',
	auto_follow: false,

	ortho: false,
	fov: 45,
	camera_distance: 70,
	aperture: 0,
	focus_distance: 0,
	auto_focus: true,
	auto_sync: false,

	env_mode: 'sky',
	scene_preset: '',
	background_preset: '',
	preview_model_overrides: {},
	time_of_day: 12,
	env_intensity: 1.0,
	env_rotation: 0,
	bg_mode: 'env',
	bg_color: '#1b1b20',
	background_blur: 0,

	sun_enable: true,
	sun_elevation: 48,
	sun_azimuth: 140,
	sun_angle: 1.2,
	sun_intensity: 6.0,
	sun_color: '#fff2dd',
	sky_zenith: '#3c78c8',
	sky_horizon: '#c6dcf2',
	sky_ground: '#5a5a5e',
	sky_haze: 0.35,

	grad_top: '#8fb6e8',
	grad_bottom: '#2a2a2e',
	solid_color: '#808080',

	ground_on: true,
	ground_y: 0,
	ground_color: '#a8a8a8',
	ground_texture_uuid: '',
	ground_texture_scale: 1,
	ground_rough: 0.9,
	ground_metal: 0,
	ground_radius: 0,
	ground_catcher: false,

	render_sides: 'auto',
	def_roughness: 0.85,
	def_metalness: 0.0,
	emissive_strength: 1.0,
	alpha_mode: 'cutout',
	alpha_cutoff: 0.5,

	tone_mapping: 'aces',
	exposure: 1.0,
	contrast: 1.0,
	saturation: 1.0,

	bloom_enable: false,
	bloom_threshold: 1.0,
	bloom_intensity: 0.5,
	bloom_radius: 2.0,
	vignette_enable: false,
	vignette_strength: 0.4,
	sharpen_enable: false,
	sharpen_strength: 0.25,
	grain_enable: false,
	grain_strength: 0.03,

	watermark_enable: false,
	watermark_text: '',
	watermark_size: 24,
	watermark_opacity: 0.85,
	watermark_color: '#ffffff',
};
