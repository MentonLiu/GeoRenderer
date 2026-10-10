import { sunDirection } from '../scene/environment.js';
import { groupChainForElement } from '../scene/group-overrides.js';
import { activeBlockbenchPreviewModels, activeBlockbenchScene } from '../scene/blockbench-scene.js';
import { syncControls } from './controls.js';
import { PTR, saveSettings } from './state.js';
import { RasterMaterials } from './raster-materials.js';
import { RasterEnvironment } from './raster-environment.js';
import { environmentCycle } from '../scene/day-cycle.js';

// 在路径追踪缓冲创建前先使用轻量栅格预览完成相机和材质检查。
export class RasterPreview {
	constructor(canvas) {
		this.canvas = canvas;
		this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		this.environment = new RasterEnvironment(this.renderer);
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
		this.previewModels = new THREE.Group();
		this.previewModelSources = [];
		this.previewModelKey = '';
		this.selectionHelper = null;
		this.ownedMaterials = [];
		this.scene.add(this.previewModels, this.model);
		this.raf = 0;
		this.running = false;
		this.refreshModel();
	}

	refreshModel() {
		this.model.clear();
		this.materials?.dispose();
		this.materials = new RasterMaterials(PTR.settings, PTR.overrides, PTR.groupOverrides);
		this.previewModelKey = '';
		this.ownedMaterials = this.materials.materials;
		if (typeof Canvas !== 'undefined' && Canvas.scene) Canvas.scene.updateMatrixWorld(true);
		const elements = (typeof Outliner !== 'undefined' && Outliner.elements) || [];
		for (const element of elements) {
			const mesh = element && element.mesh;
			if (!mesh || element.visibility === false || mesh.visible === false) continue;
			const clone = mesh.clone(true);
			clone.userData.georendererSourceMesh = mesh;
			const groupChain = groupChainForElement(element);
			clone.traverse(object => { object.userData.georendererGroupChain = groupChain; });
			clone.traverse(object => {
				if (!object.isMesh || !object.material) return;
				const customize = material => this.materials.create(material, groupChain);
				object.material = Array.isArray(object.material) ? object.material.map(customize) : customize(object.material);
			});
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

	syncPreviewModels() {
		const models = activeBlockbenchPreviewModels();
		const key = models.map(model => {
			const root = model.model_3d;
			return `${root.uuid}:${root.children.map(child => child.uuid).join(',')}`;
		}).join('|');
		if (key !== this.previewModelKey) {
			this.previewModels.clear();
			this.previewMaterials?.dispose();
			this.previewMaterials = new RasterMaterials(PTR.settings, {}, {});
			this.previewModelSources = models.map(model => {
				const clone = model.model_3d.clone(true);
				clone.traverse(object => {
					if (!object.isMesh || !object.material) return;
					const customize = source => this.previewMaterials.createPreview(source);
					object.material = Array.isArray(object.material) ? object.material.map(customize) : customize(object.material);
				});
				clone.matrixAutoUpdate = false;
				this.previewModels.add(clone);
				return { source: model.model_3d, clone };
			});
			this.previewModelKey = key;
		}
		for (const { source, clone } of this.previewModelSources) {
			source.updateWorldMatrix(true, false);
			clone.matrix.copy(source.matrixWorld);
			clone.visible = source.visible;
		}
		this.previewModels.updateMatrixWorld(true);
		return models;
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
		const toneMaps = { none: THREE.NoToneMapping, reinhard: THREE.ReinhardToneMapping, aces: THREE.ACESFilmicToneMapping, filmic: THREE.CineonToneMapping, agx: THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping };
		this.renderer.toneMapping = toneMaps[settings.tone_mapping] ?? THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = settings.exposure;
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
		const blockbenchScene = PTR.step === 'materials' ? null : activeBlockbenchScene();
		const backgroundScene = PTR.step !== 'materials' && settings.env_mode === 'image' && PTR.customEnvSource === 'scene' ? PTR.backgroundScene : null;
		const cam = (inspection ? PTR.inspectionCam : PTR.cam).state();
		if (PTR.step === 'scene' && blockbenchScene?.fov && !cam.ortho) cam.fov = blockbenchScene.fov;
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
		this.previewModels.visible = PTR.step !== 'materials';
		const previewModels = this.previewModels.visible ? this.syncPreviewModels() : [];
		for (const material of [...this.materials.materials, ...(this.previewMaterials?.materials || []), this.floor.material]) material.envMapIntensity = Math.max(0, settings.env_intensity);
		this.grid.visible = PTR.step === 'materials';
		const hasSceneGeometry = blockbenchScene?.preview_models?.some(model => previewModels.includes(model));
		const showGround = !this.grid.visible && !hasSceneGeometry;
		this.floor.visible = showGround && !!settings.ground_on && !(settings.ground_radius > 0);
		this.groundDisk.visible = showGround && !!settings.ground_on && settings.ground_radius > 0;
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
		const cycle = environmentCycle(settings);
		this.ambient.intensity = 0.15 * cycle.brightness * Math.max(0, settings.env_intensity);
		this.ambient.color.copy(backgroundScene?.light_color || new THREE.Color(0xffffff));
		this.ambient.color.multiply(new THREE.Color().setRGB(...cycle.tint));
		this.sun.visible = !!settings.sun_enable && cycle.sunStrength > 0;
		const dir = sunDirection(settings);
		this.sun.position.set(dir[0] * 100, dir[1] * 100, dir[2] * 100);
		this.sun.intensity = Math.max(0, settings.sun_intensity / 4) * cycle.sunStrength;
		this.sun.color.set(settings.sun_color);
		this.sun.color.multiply(new THREE.Color().setRGB(...cycle.sunTint));
		this.scene.fog = backgroundScene?.fog?.clone() || null;
		if (this.scene.fog) this.scene.fog.color.multiply(new THREE.Color().setRGB(...cycle.tint).multiplyScalar(cycle.brightness));
		this.scene.environment = this.environment.sync(settings, PTR.customEnv);
		this.scene.background = this.grid.visible ? new THREE.Color('#20242b') : settings.bg_mode === 'transparent' ? null
			: settings.bg_mode === 'color' ? new THREE.Color(settings.bg_color) : this.environment.background;
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
		this.scene.environment = this.scene.background = null;
		this.environment.release();
	}

	dispose() {
		this.previewMaterials?.dispose();
		this.stop();
		this.highlightGroup(null);
		this.model.clear();
		this.previewModels.clear();
		this.previewModelSources = [];
		this.materials?.dispose();
		this.ownedMaterials = [];
		this.environment.dispose();
		this.floor.geometry.dispose();
		this.groundDisk.geometry.dispose();
		this.floor.material.dispose();
		if (this.groundMap) this.groundMap.dispose();
		this.renderer.dispose();
	}
}
