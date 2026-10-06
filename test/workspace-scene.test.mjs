import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceScene } from '../plugins/georenderer/src/ui/workspace-scene.js';
import { PTR } from '../plugins/georenderer/src/ui/state.js';

test('native workspace scene dressing updates with time and restores Blockbench state', t => {
	const previous = {
		THREE: globalThis.THREE, Canvas: globalThis.Canvas, Preview: globalThis.Preview,
		requestAnimationFrame: globalThis.requestAnimationFrame,
		cancelAnimationFrame: globalThis.cancelAnimationFrame,
		settings: PTR.settings, customEnv: PTR.customEnv, sceneCubemap: PTR.sceneCubemap,
	};
	t.after(() => {
		for (const key of ['THREE', 'Canvas', 'Preview', 'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[key] = previous[key];
		PTR.settings = previous.settings;
		PTR.customEnv = previous.customEnv;
		PTR.sceneCubemap = previous.sceneCubemap;
	});
	class Color {
		constructor(value) { this.value = value; }
		set(value) { this.value = value; return this; }
		multiplyScalar(value) { this.scalar = value; return this; }
	}
	class Light {
		constructor() {
			this.color = new Color('#ffffff');
			this.position = { set(...values) { this.values = values; } };
		}
	}
	class Material {
		constructor() { this.color = new Color('#ffffff'); }
		dispose() {}
	}
	globalThis.THREE = {
		AmbientLight: Light,
		DirectionalLight: Light,
		PlaneGeometry: class { dispose() {} },
		MeshStandardMaterial: Material,
		Mesh: class {
			constructor(geometry, material) { this.geometry = geometry; this.material = material; this.rotation = {}; this.position = {}; }
		},
		DataTexture: class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } dispose() {} },
		RGBAFormat: 'rgba', EquirectangularReflectionMapping: 'equirect',
		Color,
	};
	const originalBackground = { name: 'original background' };
	const originalEnvironment = { name: 'original environment' };
	const attached = new Set();
	const scene = {
		background: originalBackground,
		environment: originalEnvironment,
		add(...objects) { objects.forEach(object => attached.add(object)); },
		remove(...objects) { objects.forEach(object => attached.delete(object)); },
	};
	globalThis.Canvas = { scene };
	globalThis.Preview = { all: [] };
	globalThis.requestAnimationFrame = () => 1;
	globalThis.cancelAnimationFrame = () => {};
	PTR.settings = { ...previous.settings, time_of_day: 12, sun_enable: true, ground_on: true, ground_texture_uuid: '' };
	PTR.customEnv = null;
	PTR.sceneCubemap = null;
	const adapter = new WorkspaceScene();
	adapter.activate();
	assert.equal(attached.size, 3);
	assert.equal(adapter.ground.visible, true);
	assert.notEqual(scene.background, originalBackground);
	const noonLight = adapter.ambient.intensity;
	PTR.settings.time_of_day = 0;
	adapter.refresh();
	assert.ok(adapter.ambient.intensity < noonLight);
	PTR.customEnv = { width: 2, height: 1, data: new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]) };
	PTR.settings.env_mode = 'image';
	PTR.settings.bg_mode = 'env';
	adapter.refresh();
	assert.equal(scene.background.mapping, 'equirect');
	assert.equal(scene.background.data.length, 8);
	adapter.deactivate();
	assert.equal(attached.size, 0);
	assert.equal(scene.background, originalBackground);
	assert.equal(scene.environment, originalEnvironment);
	adapter.dispose();
});
