import { sunDirection } from '../scene/environment.js';
import { groupChainForElement, resolveMaterialOverride } from '../scene/group-overrides.js';
import { PTR } from './state.js';

// A separate THREE renderer keeps the first two steps responsive without
// allocating any path-tracing buffers or compiling the path-tracing shaders.
export class RasterPreview {
	constructor(canvas) {
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
		this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
		this.ambient = new THREE.AmbientLight(0xffffff, 1.2);
		this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
		this.scene.add(this.ambient, this.sun);
		this.grid = new THREE.GridHelper(256, 32, 0x5b6874, 0x353d48);
		this.scene.add(this.grid);
		this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xa8a8a8, roughness: 0.9 }));
		this.groundMap = null;
		this.floor.rotation.x = -Math.PI / 2;
		this.scene.add(this.floor);
		this.model = new THREE.Group();
		this.ownedMaterials = [];
		this.scene.add(this.model);
		this.raf = 0;
		this.running = false;
		this.refreshModel();
	}

	refreshModel() {
		this.model.clear();
		for (const material of this.ownedMaterials) material.dispose();
		this.ownedMaterials = [];
		if (typeof Canvas !== 'undefined' && Canvas.scene) Canvas.scene.updateMatrixWorld(true);
		const elements = (typeof Outliner !== 'undefined' && Outliner.elements) || [];
		for (const element of elements) {
			const mesh = element && element.mesh;
			if (!mesh || element.visibility === false || mesh.visible === false) continue;
			const clone = mesh.clone(true);
			const override = resolveMaterialOverride(null, groupChainForElement(element), null, PTR.groupOverrides);
			if (Object.keys(override).length) {
				clone.traverse(object => {
					if (!object.isMesh || !object.material) return;
					const customize = material => {
						const copy = material.clone();
						if (override.roughness != null && 'roughness' in copy) copy.roughness = override.roughness;
						if (override.metalness != null && 'metalness' in copy) copy.metalness = override.metalness;
						if (override.emissive != null && copy.emissive) {
							copy.emissive.set(override.emissive_color || '#ffffff');
							copy.emissiveIntensity = override.emissive;
						}
						this.ownedMaterials.push(copy);
						return copy;
					};
					object.material = Array.isArray(object.material) ? object.material.map(customize) : customize(object.material);
				});
			}
			clone.matrix.copy(mesh.matrixWorld);
			clone.matrixAutoUpdate = false;
			this.model.add(clone);
		}
	}

	setGroundTexture(texture) {
		if (this.groundMap) this.groundMap.dispose();
		const image = texture && (texture.canvas || texture.img);
		this.groundMap = image ? new THREE.Texture(image) : null;
		if (this.groundMap) {
			this.groundMap.wrapS = THREE.RepeatWrapping;
			this.groundMap.wrapT = THREE.RepeatWrapping;
			this.groundMap.needsUpdate = true;
		}
		this.floor.material.map = this.groundMap;
		this.floor.material.needsUpdate = true;
	}

	draw() {
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		if (this.width !== width || this.height !== height) {
			this.width = width; this.height = height;
			this.renderer.setSize(width, height, false);
		}
		const settings = PTR.settings;
		if (settings.auto_sync) PTR.cam.syncFromPreview();
		const cam = PTR.cam.state();
		const target = cam.ortho ? this.orthoCamera : this.camera;
		if (cam.ortho) {
			const halfH = cam.orthoHalfHeight;
			target.left = -halfH * width / height;
			target.right = halfH * width / height;
			target.top = halfH;
			target.bottom = -halfH;
		} else {
			target.fov = cam.fov;
			target.aspect = width / height;
		}
		target.updateProjectionMatrix();
		target.position.set(...cam.pos);
		target.lookAt(...cam.target);
		this.grid.visible = PTR.step === 'camera';
		this.floor.visible = PTR.step !== 'camera' && !!settings.ground_on;
		this.floor.position.y = settings.ground_y;
		this.floor.material.color.set(settings.ground_color);
		this.floor.material.roughness = settings.ground_rough;
		this.floor.material.metalness = settings.ground_metal;
		if (this.groundMap) {
			const repeat = 2000 / Math.max(0.01, settings.ground_texture_scale || 1);
			this.groundMap.repeat.set(repeat, repeat);
		}
		this.sun.visible = PTR.step !== 'camera' && !!settings.sun_enable;
		const dir = sunDirection(settings);
		this.sun.position.set(dir[0] * 100, dir[1] * 100, dir[2] * 100);
		this.sun.intensity = Math.max(0, settings.sun_intensity / 4);
		this.sun.color.set(settings.sun_color);
		this.scene.background = PTR.step !== 'camera' && settings.bg_mode === 'transparent' ? null
			: PTR.step !== 'camera' && PTR.sceneCubemap && settings.bg_mode === 'env'
			? PTR.sceneCubemap
			: new THREE.Color(PTR.step === 'camera' ? '#252b34' : settings.bg_mode === 'color' ? settings.bg_color : settings.sky_horizon);
		this.renderer.render(this.scene, target);
	}

	start() {
		if (this.running) return;
		this.running = true;
		const frame = () => {
			if (!this.running) return;
			if (this.canvas.isConnected) this.draw();
			this.raf = requestAnimationFrame(frame);
		};
		frame();
	}

	stop() {
		this.running = false;
		cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	dispose() {
		this.stop();
		this.model.clear();
		for (const material of this.ownedMaterials) material.dispose();
		this.ownedMaterials = [];
		this.floor.geometry.dispose();
		this.floor.material.dispose();
		if (this.groundMap) this.groundMap.dispose();
		this.renderer.dispose();
	}
}
