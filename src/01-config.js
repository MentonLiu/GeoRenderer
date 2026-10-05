	const PLUGIN_ID = 'georenderer';

	const TRI_POS_TEXELS = 3;
	const TRI_ATTR_TEXELS = 4;
	const MAT_TEXELS = 5;
	const BVH_TEXELS = 2;
	const DATA_TEX_WIDTH = 1024;
	const MAX_LEAF_TRIS = 8;
	const SAH_BINS = 12;
	const ENV_W = 1024, ENV_H = 512;
	const ENV_DIST_W = 256, ENV_DIST_H = 128;

	const INTERACTIVE_MAX_BOUNCE = 2;
	const INTERACTIVE_PASS_CAP = 8;
	const IDLE_PASS_CAP = 64;

	const DEFAULTS = {
		res_mode: 'fit',
		res_width: 1280,
		res_height: 720,
		render_mode: 'preview',
		preview_samples: 8,
		final_samples: 256,
		max_bounce: 6,
		light_samples: 1,
		clamp_value: 12,
		filter_linear: false,
		denoise: true,
		denoise_strength: 1.0,
		interactive_scale: 0.2,
		auto_follow: false,

		ortho: false,
		fov: 45,
		aperture: 0,
		focus_distance: 0,
		auto_focus: true,
		auto_sync: false,

		env_mode: 'sky',
		env_intensity: 1.0,
		env_rotation: 0,
		bg_mode: 'env',
		bg_color: '#1b1b20',

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
