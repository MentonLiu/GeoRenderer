import { generateSkyPixels, resampleEquirect } from '../scene/environment.js';
import { MAX_ENV_IMAGE_SIZE } from '../core/config.js';
import { applyEnvironmentCycle } from '../scene/day-cycle.js';

const ENV_KEYS = ['env_mode', 'env_rotation', 'time_of_day', 'day_cycle', 'sky_zenith', 'sky_horizon', 'sky_ground', 'sky_haze', 'grad_top', 'grad_bottom', 'solid_color', 'sun_enable', 'sun_elevation', 'sun_azimuth', 'sun_angle', 'sun_intensity', 'sun_color'];

function rotatePixels(data, width, height, rotation) {
	const rotated = new Float32Array(data.length);
	const shift = Math.round((rotation || 0) / 360 * width);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const sx = ((x + shift) % width + width) % width;
		rotated.set(data.subarray((y * width + sx) * 4, (y * width + sx) * 4 + 4), (y * width + x) * 4);
	}
	return rotated;
}

export class RasterEnvironment {
	constructor(renderer) {
		this.pmrem = new THREE.PMREMGenerator(renderer);
		this.maxTextureSize = renderer.capabilities?.maxTextureSize || MAX_ENV_IMAGE_SIZE;
		this.target = null;
		this.key = '';
		this.source = null;
		this.background = null;
	}

	sync(settings, customEnv) {
		const source = settings.env_mode === 'image' ? customEnv : null;
		const key = JSON.stringify(ENV_KEYS.map(k => settings[k]));
		if (this.target && this.key === key && this.source === source) return this.target.texture;
		const w = 256, h = 128;
		const data = source ? applyEnvironmentCycle(resampleEquirect(source, w, h), settings) : generateSkyPixels(settings, w, h);
		const rotated = rotatePixels(data, w, h, settings.env_rotation);
		const texture = new THREE.DataTexture(rotated, w, h, THREE.RGBAFormat, THREE.FloatType);
		texture.mapping = THREE.EquirectangularReflectionMapping;
		texture.flipY = true;
		texture.needsUpdate = true;
		let target;
		try { target = this.pmrem.fromEquirectangular(texture); }
		finally { texture.dispose(); }
		this.target?.dispose();
		this.background?.dispose();
		const bgWidth = source ? Math.min(MAX_ENV_IMAGE_SIZE, this.maxTextureSize, source.width) : w;
		const bgHeight = source ? Math.max(1, Math.round(bgWidth * source.height / source.width)) : h;
		const bgData = source ? rotatePixels(applyEnvironmentCycle(resampleEquirect(source, bgWidth, bgHeight), settings), bgWidth, bgHeight, settings.env_rotation) : rotated;
		this.background = new THREE.DataTexture(bgData, bgWidth, bgHeight, THREE.RGBAFormat, THREE.FloatType);
		this.background.mapping = THREE.EquirectangularReflectionMapping;
		this.background.magFilter = THREE.LinearFilter;
		this.background.minFilter = THREE.LinearFilter;
		this.background.flipY = true;
		this.background.needsUpdate = true;
		this.target = target;
		this.key = key;
		this.source = source;
		return target.texture;
	}

	release() {
		this.target?.dispose();
		this.background?.dispose();
		this.target = this.background = this.source = null;
		this.key = '';
	}

	dispose() {
		this.release();
		this.pmrem.dispose();
	}
}
