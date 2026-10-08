import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGeometry } from '../plugins/georenderer/src/scene/geometry.js';
import { restoreBlockbenchSceneSelection } from '../plugins/georenderer/src/scene/blockbench-scene.js';

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function previewFixture() {
	const material = { uuid: 'preview-material', color: { r: 1, g: 1, b: 1 }, side: 2 };
	const mesh = {
		isMesh: true, visible: true, material, matrixWorld: { elements: identity }, children: [],
		geometry: {
			attributes: {
				position: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), count: 3, itemSize: 3 },
				normal: { array: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), itemSize: 3 },
				uv: { array: new Float32Array([0, 0, 1, 0, 0, 1]), itemSize: 2 },
			},
			index: null, groups: [],
		},
	};
	const model = { model_3d: { isObject3D: true, visible: true, children: [mesh], updateWorldMatrix() {} } };
	return { material, mesh, model };
}

test('preview scene meshes and independent reference models enter the trace geometry', t => {
	const previous = [globalThis.Canvas, globalThis.Outliner, globalThis.PreviewScene, globalThis.PreviewModel];
	t.after(() => {
		restoreBlockbenchSceneSelection('');
		[globalThis.Canvas, globalThis.Outliner, globalThis.PreviewScene, globalThis.PreviewModel] = previous;
	});
	globalThis.Canvas = { scene: { updateMatrixWorld() {} } };
	globalThis.Outliner = { elements: [] };
	const { material, mesh, model } = previewFixture();
	globalThis.PreviewModel = { getActiveModels: () => [model] };
	const scene = { id: 'test', preview_models: [model], fog: { isFogExp2: true, density: 0.1 } };
	globalThis.PreviewScene = { active: null, scenes: { test: scene } };
	restoreBlockbenchSceneSelection('test');
	let geometry = collectGeometry();
	assert.equal(geometry.triCount, 1);
	assert.equal(geometry.previewTriCount, 1);
	assert.equal(geometry.sceneTriCount, 1);
	assert.equal(geometry.texRefs[0].previewMaterial, material);
	assert.deepEqual([...geometry.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
	assert.equal(geometry.fog.density, 0.1);

	restoreBlockbenchSceneSelection('');
	scene.preview_models = [];
	geometry = collectGeometry();
	assert.equal(geometry.previewTriCount, 1);
	assert.equal(geometry.sceneTriCount, 0);
	mesh.visible = false;
	assert.equal(collectGeometry().triCount, 0);
});
