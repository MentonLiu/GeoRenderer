import { sunDirection } from '../scene/environment.js';
import { groupChainForElement, resolveMaterialOverride } from '../scene/group-overrides.js';
import { syncControls } from './controls.js';
import { PTR, saveSettings } from './state.js';

// Camera setup uses a lightweight preview before path-tracing buffers exist.
export class RasterPreview {
	constructor(canvas) {
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		this.scene = new THREE.Scene();
		this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100000);
		this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100000);
		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
		this.activeCamera = this.camera;
		this.ambient = new THREE.AmbientLight(0xffffff, 1.2);
		this.sun = new THREE.DirectionalLight(0xffffff, 1.5);
		this.scene.add(this.ambient, this.sun);
		this.grid = new THREE.GridHelper(256, 32, 0x5b6874, 0x353d48);
		this.scene.add(this.grid);
		this.floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0xa8a8a8, roughness: 0.9 }));
		this.groundMap = null;
		this.floor.rotation.x = -Math.PI / 2;
		this.scene.add(this.floor);
		this.groundDisk = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.floor.material);
		this.groundDisk.rotation.x = -Math.PI / 2;
		this.scene.add(this.groundDisk);
		this.model = new THREE.Group();
		this.selectionHelper = null;
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
			clone.userData.georendererSourceMesh = mesh;
			const groupChain = groupChainForElement(element);
			clone.traverse(object => { object.userData.georendererGroupChain = groupChain; });
			const override = resolveMaterialOverride(null, groupChain, null, PTR.groupOverrides);
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
		this.model.updateMatrixWorld(true);
		this.highlightGroup(PTR.selectedGroupUuid);
	}

	syncModelPose() {
		if (typeof Canvas !== 'undefined' && Canvas.scene) Canvas.scene.updateMatrixWorld(true);
		for (const clone of this.model.children) {
			const source = clone.userData.georendererSourceMesh;
			if (!source) continue;
			clone.visible = source.visible;
			clone.matrix.copy(source.matrixWorld);
		}
		this.model.updateMatrixWorld(true);
	}

	pickGroupAt(clientX, clientY) {
		const rect = this.canvas.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		this.pointer.set(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1,
		);
		this.raycaster.setFromCamera(this.pointer, this.activeCamera);
		for (const hit of this.raycaster.intersectObjects(this.model.children, true)) {
			const chain = hit.object.userData.georendererGroupChain;
			if (chain?.length) return chain[0];
		}
		return null;
	}

	highlightGroup(uuid) {
		if (this.selectionHelper) {
			this.scene.remove(this.selectionHelper);
			this.selectionHelper.geometry.dispose();
			this.selectionHelper.material.dispose();
			this.selectionHelper = null;
		}
		if (!uuid) return;
		const bounds = new THREE.Box3();
		for (const clone of this.model.children) {
			if (clone.userData.georendererGroupChain?.includes(uuid)) bounds.expandByObject(clone);
		}
		if (bounds.isEmpty()) return;
		this.selectionHelper = new THREE.Box3Helper(bounds, new THREE.Color('#ffb74d'));
		this.scene.add(this.selectionHelper);
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
		this.syncModelPose();
		const width = Math.max(1, this.canvas.clientWidth);
		const height = Math.max(1, this.canvas.clientHeight);
		if (this.width !== width || this.height !== height) {
			this.width = width; this.height = height;
			this.renderer.setSize(width, height, false);
		}
		const settings = PTR.settings;
		if (settings.auto_sync && PTR.step === 'camera' && PTR.cam.syncFromPreview()) {
			if (settings.fov !== PTR.cam.fov || settings.ortho !== PTR.cam.ortho || settings.camera_distance !== PTR.cam.distance) {
				settings.fov = PTR.cam.fov;
				settings.ortho = PTR.cam.ortho;
				settings.camera_distance = PTR.cam.distance;
				syncControls();
				saveSettings();
			}
		}
		const inspection = PTR.step === 'materials' || PTR.step === 'scene';
		const cam = (inspection ? PTR.inspectionCam : PTR.cam).state();
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
		target.updateMatrixWorld(true);
		this.activeCamera = target;
		this.grid.visible = PTR.step === 'materials';
		this.floor.visible = !this.grid.visible && !!settings.ground_on && !(settings.ground_radius > 0);
		this.groundDisk.visible = !this.grid.visible && !!settings.ground_on && settings.ground_radius > 0;
		this.floor.position.y = settings.ground_y;
		this.groundDisk.position.y = settings.ground_y;
		if (this.groundDisk.visible) this.groundDisk.scale.setScalar(settings.ground_radius);
		this.floor.material.color.set(settings.ground_color);
		this.floor.material.roughness = settings.ground_rough;
		this.floor.material.metalness = settings.ground_metal;
		this.floor.material.transparent = !!settings.ground_catcher;
		this.floor.material.opacity = settings.ground_catcher ? 0.25 : 1;
		if (this.groundMap) {
			const repeat = 2000 / Math.max(0.01, settings.ground_texture_scale || 1);
			this.groundMap.repeat.set(repeat, repeat);
		}
		const daylight = Math.max(0.1, Math.min(1, (Math.sin((settings.time_of_day - 6) * Math.PI / 12) + 0.2) / 1.2));
		this.ambient.intensity = 0.2 + daylight * Math.max(0, settings.env_intensity);
		this.sun.visible = !!settings.sun_enable;
		const dir = sunDirection(settings);
		this.sun.position.set(dir[0] * 100, dir[1] * 100, dir[2] * 100);
		this.sun.intensity = Math.max(0, settings.sun_intensity / 4);
		this.sun.color.set(settings.sun_color);
		this.scene.background = this.grid.visible ? new THREE.Color('#20242b') : settings.bg_mode === 'transparent' ? null
			: PTR.sceneCubemap && settings.bg_mode === 'env'
			? PTR.sceneCubemap
			: new THREE.Color(settings.bg_mode === 'color' ? settings.bg_color : settings.sky_horizon).multiplyScalar(settings.bg_mode === 'color' ? 1 : 0.12 + 0.88 * daylight);
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
		this.highlightGroup(null);
		this.model.clear();
		for (const material of this.ownedMaterials) material.dispose();
		this.ownedMaterials = [];
		this.floor.geometry.dispose();
		this.groundDisk.geometry.dispose();
		this.floor.material.dispose();
		if (this.groundMap) this.groundMap.dispose();
		this.renderer.dispose();
	}
}
