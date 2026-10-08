import { generateSkyPixels, resampleEquirect } from '../scene/environment.js';

const ENV_KEYS = ['env_mode', 'env_rotation', 'time_of_day', 'sky_zenith', 'sky_horizon', 'sky_ground', 'sky_haze', 'grad_top', 'grad_bottom', 'solid_color', 'sun_enable', 'sun_elevation', 'sun_azimuth', 'sun_angle', 'sun_intensity', 'sun_color'];

export class RasterEnvironment {
	constructor(renderer) {
		this.pmrem = new THREE.PMREMGenerator(renderer);
		this.target = null;
		this.key = '';
		this.source = null;
	}

	sync(settings, customEnv) {
		const source = settings.env_mode === 'image' ? customEnv : null;
		const key = JSON.stringify(ENV_KEYS.map(k => settings[k]));
		if (this.target && this.key === key && this.source === source) return this.target.texture;
		const w = 256, h = 128;
		const data = source ? resampleEquirect(source, w, h) : generateSkyPixels(settings, w, h);
		const rotated = new Float32Array(data.length);
		const shift = Math.round((settings.env_rotation || 0) / 360 * w);
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
			const sx = ((x + shift) % w + w) % w;
			rotated.set(data.subarray((y * w + sx) * 4, (y * w + sx) * 4 + 4), (y * w + x) * 4);
		}
		const texture = new THREE.DataTexture(rotated, w, h, THREE.RGBAFormat, THREE.FloatType);
		texture.mapping = THREE.EquirectangularReflectionMapping;
		texture.flipY = true;
		texture.needsUpdate = true;
		let target;
		try { target = this.pmrem.fromEquirectangular(texture); }
		finally { texture.dispose(); }
		this.target?.dispose();
		this.target = target;
		this.key = key;
		this.source = source;
		return target.texture;
	}

	dispose() {
		this.target?.dispose();
		this.pmrem.dispose();
	}
}
