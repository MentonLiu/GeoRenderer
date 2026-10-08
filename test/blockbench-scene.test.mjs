import test from 'node:test';
import assert from 'node:assert/strict';
import {
	activeBlockbenchPreviewModels,
	activeBlockbenchScene,
	listBlockbenchPreviewModels,
	listBlockbenchScenes,
	loadBlockbenchScene,
	restoreBlockbenchPreviewModelOverrides,
	restoreBlockbenchSceneSelection,
	selectBlockbenchScene,
	setBlockbenchPreviewModelEnabled,
} from '../plugins/georenderer/src/scene/blockbench-scene.js';
import { RasterPreview } from '../plugins/georenderer/src/ui/raster-preview.js';

test('GeoRenderer scene selection stays local and excludes the main viewport scene', async t => {
	const originalScenes = globalThis.PreviewScene;
	const originalModels = globalThis.PreviewModel;
	t.after(() => {
		restoreBlockbenchSceneSelection('');
		globalThis.PreviewScene = originalScenes;
		globalThis.PreviewModel = originalModels;
	});
	const sceneModel = { id: 'studio-floor', model_3d: { isObject3D: true }, update() {} };
	const mainModel = { id: 'main-floor', model_3d: { isObject3D: true } };
	const player = { id: 'player', model_3d: { isObject3D: true } };
	const scene = {
		id: 'studio', name: 'Studio', category: 'generic', preview_models: [sceneModel],
		async select() { throw new Error('must not select in the main viewport'); },
	};
	const mainScene = { id: 'main', preview_models: [mainModel] };
	globalThis.PreviewScene = { scenes: { studio: scene, main: mainScene }, active: mainScene };
	globalThis.PreviewModel = { getActiveModels: () => [mainModel, player] };
	assert.equal(listBlockbenchScenes().length, 2);
	assert.deepEqual(activeBlockbenchPreviewModels().map(model => model.id), ['player']);
	assert.equal(await selectBlockbenchScene('studio'), true);
	assert.equal(activeBlockbenchScene(), scene);
	assert.equal(globalThis.PreviewScene.active, mainScene);
	assert.deepEqual(activeBlockbenchPreviewModels().map(model => model.id), ['studio-floor', 'player']);
	assert.equal(await selectBlockbenchScene(''), true);
	assert.equal(activeBlockbenchScene(), null);
	assert.equal(globalThis.PreviewScene.active, mainScene);
	assert.deepEqual(activeBlockbenchPreviewModels().map(model => model.id), ['player']);
});

test('lazy scene resources load without activating the Blockbench viewport', async t => {
	const original = globalThis.PreviewScene;
	t.after(() => { restoreBlockbenchSceneSelection(''); globalThis.PreviewScene = original; });
	const scene = {
		id: 'remote', loaded: false, preview_models: [],
		async lazyLoadFromWeb() { this.loaded = true; this.preview_models = [{ model_3d: { isObject3D: true } }]; },
		async select() { throw new Error('must not select in the main viewport'); },
	};
	globalThis.PreviewScene = { scenes: { remote: scene }, active: null };
	assert.equal(await selectBlockbenchScene('remote'), true);
	assert.equal(activeBlockbenchPreviewModels().length, 1);
	assert.equal(globalThis.PreviewScene.active, null);
	assert.deepEqual(await loadBlockbenchScene('remote'), { cubemap: null, environment: null });
});

test('plugin reference model switches do not change Blockbench model visibility', t => {
	const previous = [globalThis.PreviewScene, globalThis.PreviewModel];
	t.after(() => {
		restoreBlockbenchSceneSelection('');
		restoreBlockbenchPreviewModelOverrides({});
		[globalThis.PreviewScene, globalThis.PreviewModel] = previous;
	});
	const player = { id: 'player', name: 'Player', enabled: false, model_3d: { isObject3D: true }, update() {} };
	globalThis.PreviewScene = { scenes: {}, active: null };
	globalThis.PreviewModel = { models: { player }, getActiveModels: () => [] };
	restoreBlockbenchPreviewModelOverrides({});
	assert.equal(listBlockbenchPreviewModels()[0].enabled, false);
	setBlockbenchPreviewModelEnabled('player', true);
	assert.equal(listBlockbenchPreviewModels()[0].enabled, true);
	assert.deepEqual(activeBlockbenchPreviewModels(), [player]);
	assert.equal(player.enabled, false);
	assert.deepEqual(setBlockbenchPreviewModelEnabled('player', false), {});
	assert.equal(activeBlockbenchPreviewModels().length, 0);
});

test('scene cubemap conversion waits for Blockbench images to finish loading', async t => {
	const originalScenes = globalThis.PreviewScene;
	const originalDocument = globalThis.document;
	t.after(() => {
		globalThis.PreviewScene = originalScenes;
		globalThis.document = originalDocument;
	});
	const cubemap = { image: new Array(6) };
	globalThis.PreviewScene = { scenes: { sky: { cubemap } } };
	globalThis.document = {
		createElement() {
			return {
				width: 0, height: 0,
				getContext() {
					return {
						drawImage() {},
						getImageData() { return { data: new Uint8ClampedArray([255, 255, 255, 255]) }; },
					};
				},
			};
		},
	};
	const pending = loadBlockbenchScene('sky');
	setTimeout(() => { cubemap.image = Array.from({ length: 6 }, () => ({ width: 1, height: 1 })); }, 10);
	const loaded = await pending;
	assert.equal(loaded.cubemap, cubemap);
	assert.equal(loaded.environment.width, 512);
	assert.equal(loaded.environment.height, 256);
	assert.equal(loaded.environment.data[0], 1);
});

test('raster preview mirrors an independently enabled player model without an active scene', t => {
	const originalModels = globalThis.PreviewModel;
	t.after(() => { globalThis.PreviewModel = originalModels; });
	const clone = { matrix: { copy(matrix) { this.source = matrix; } }, traverse() {} };
	const root = {
		isObject3D: true, uuid: 'player-root', children: [{ uuid: 'body' }], visible: true,
		matrixWorld: { name: 'player-transform' },
		clone() { return clone; }, updateWorldMatrix() {},
	};
	globalThis.PreviewModel = { getActiveModels: () => [{ id: 'player', model_3d: root }] };
	const preview = {
		previewModelKey: '', previewModelSources: [],
		previewModels: {
			children: [], clear() { this.children = []; },
			add(child) { this.children.push(child); }, updateMatrixWorld() {},
		},
	};
	const models = RasterPreview.prototype.syncPreviewModels.call(preview);
	assert.equal(models.length, 1);
	assert.equal(preview.previewModels.children[0], clone);
	assert.equal(clone.matrix.source, root.matrixWorld);
});
