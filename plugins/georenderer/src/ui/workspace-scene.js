import { sunDirection } from '../scene/environment.js';
import { PTR } from './state.js';

// Temporary scene dressing for Blockbench's own Preview viewports. No model or
// camera is copied, and every scene object is removed when leaving step 2.
export class WorkspaceScene {
	constructor() {
		this.scene = null;
		this.ambient = new THREE.AmbientLight(0xffffff, 0);
		this.sun = new THREE.DirectionalLight(0xffffff, 0);
		this.ground = new THREE.Mesh(
			new THREE.PlaneGeometry(2000, 2000),
			new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }),
		);
		this.ground.rotation.x = -Math.PI / 2;
		this.ground.receiveShadow = true;
		this.groundMap = null;
		this.groundTextureUuid = null;
		this.environmentSource = null;
		this.environmentTexture = null;
		this.renderRequest = 0;
	}

	activate() {
		const scene = typeof Canvas !== 'undefined' && Canvas.scene;
		if (!scene || this.scene === scene) return;
		this.deactivate();
		this.scene = scene;
		this.originalBackground = scene.background;
		this.originalEnvironment = scene.environment;
		scene.add(this.ambient, this.sun, this.ground);
		this.refresh();
	}

	refresh() {
		if (!this.scene) return;
		const s = PTR.settings;
		const daylight = Math.max(0.08, Math.min(1, (Math.sin((s.time_of_day - 6) * Math.PI / 12) + 0.2) / 1.2));
		const direction = sunDirection(s);
		this.ambient.intensity = (0.2 + daylight) * Math.max(0, s.env_intensity);
		this.sun.visible = !!s.sun_enable;
		this.sun.intensity = Math.max(0, s.sun_intensity / 4);
		this.sun.color.set(s.sun_color);
		this.sun.position.set(direction[0] * 100, direction[1] * 100, direction[2] * 100);
		this.ground.visible = !!s.ground_on;
		this.ground.position.y = s.ground_y;
		this.ground.material.color.set(s.ground_color);
		this.ground.material.roughness = s.ground_rough;
		this.ground.material.metalness = s.ground_metal;
		this.ground.material.transparent = !!s.ground_catcher;
		this.ground.material.opacity = s.ground_catcher ? 0.25 : 1;
		this.updateGroundTexture(s.ground_texture_uuid);
		if (this.groundMap) {
			const repeat = 2000 / Math.max(0.01, s.ground_texture_scale || 1);
			this.groundMap.repeat.set(repeat, repeat);
		}
		const environment = s.env_mode === 'image' ? (PTR.sceneCubemap || this.getEnvironmentTexture()) : null;
		this.appliedBackground = s.bg_mode === 'transparent' ? null
			: s.bg_mode === 'env' && environment ? environment
			: new THREE.Color(s.bg_mode === 'color' ? s.bg_color : s.sky_horizon)
				.multiplyScalar(s.bg_mode === 'color' ? 1 : 0.12 + 0.88 * daylight);
		this.scene.background = this.appliedBackground;
		this.appliedEnvironment = environment || this.originalEnvironment;
		this.scene.environment = this.appliedEnvironment;
		this.requestRender();
	}

	getEnvironmentTexture() {
		const source = PTR.customEnv;
		if (!source?.data || !source.width || !source.height || typeof THREE.DataTexture === 'undefined') return null;
		if (source === this.environmentSource) return this.environmentTexture;
		if (this.environmentTexture) this.environmentTexture.dispose();
		const width = Math.min(source.width, 512);
		const height = Math.min(source.height, 256);
		const pixels = new Uint8Array(width * height * 4);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const sx = Math.min(source.width - 1, Math.floor(x * source.width / width));
				const sy = Math.min(source.height - 1, Math.floor(y * source.height / height));
				const from = (sy * source.width + sx) * 4;
				const to = (y * width + x) * 4;
				for (let channel = 0; channel < 3; channel++) {
					pixels[to + channel] = Math.round(Math.pow(Math.min(1, Math.max(0, source.data[from + channel])), 1 / 2.2) * 255);
				}
				pixels[to + 3] = 255;
			}
		}
		const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
		texture.mapping = THREE.EquirectangularReflectionMapping;
		if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
		else if (THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
		texture.needsUpdate = true;
		this.environmentSource = source;
		this.environmentTexture = texture;
		return texture;
	}

	updateGroundTexture(uuid) {
		if (uuid === this.groundTextureUuid) {
			if (this.groundMap) this.groundMap.needsUpdate = true;
			return;
		}
		this.groundTextureUuid = uuid;
		if (this.groundMap) this.groundMap.dispose();
		const texture = ((typeof Texture !== 'undefined' && Texture.all) || []).find(item => item.uuid === uuid);
		const image = texture && (texture.canvas || texture.img);
		this.groundMap = image ? new THREE.Texture(image) : null;
		if (this.groundMap) {
			this.groundMap.wrapS = this.groundMap.wrapT = THREE.RepeatWrapping;
			this.groundMap.needsUpdate = true;
		}
		this.ground.material.map = this.groundMap;
		this.ground.material.needsUpdate = true;
	}

	requestRender() {
		if (this.renderRequest) return;
		this.renderRequest = requestAnimationFrame(() => {
			this.renderRequest = 0;
			if (!this.scene) return;
			for (const preview of (typeof Preview !== 'undefined' && Preview.all) || []) {
				if (preview.node?.isConnected) preview.render();
			}
		});
	}

	deactivate() {
		if (!this.scene) return;
		if (this.scene.background === this.appliedBackground) this.scene.background = this.originalBackground;
		if (this.scene.environment === this.appliedEnvironment) this.scene.environment = this.originalEnvironment;
		this.scene.remove(this.ambient, this.sun, this.ground);
		this.scene = null;
		cancelAnimationFrame(this.renderRequest);
		this.renderRequest = 0;
		for (const preview of (typeof Preview !== 'undefined' && Preview.all) || []) {
			if (preview.node?.isConnected) preview.render();
		}
	}

	dispose() {
		this.deactivate();
		this.ground.geometry.dispose();
		this.ground.material.dispose();
		if (this.groundMap) this.groundMap.dispose();
		if (this.environmentTexture) this.environmentTexture.dispose();
	}
}
