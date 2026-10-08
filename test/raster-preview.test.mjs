import assert from 'node:assert/strict';
import test from 'node:test';
import { RasterPreview } from '../plugins/georenderer/src/ui/raster-preview.js';
import { PTR } from '../plugins/georenderer/src/ui/state.js';

function matrix(x = 0) {
	return {
		elements: Array.from({ length: 16 }, (_, index) => index === 12 ? x : 0),
		copy(other) {
			this.elements = [...other.elements];
			return this;
		},
	};
}

test('raster preview retains source world transforms when refreshing group overrides', t => {
	const previous = {
		Canvas: globalThis.Canvas,
		Outliner: globalThis.Outliner,
		groupOverrides: PTR.groupOverrides,
		selectedGroupUuid: PTR.selectedGroupUuid,
	};
	t.after(() => {
		globalThis.Canvas = previous.Canvas;
		globalThis.Outliner = previous.Outliner;
		PTR.groupOverrides = previous.groupOverrides;
		PTR.selectedGroupUuid = previous.selectedGroupUuid;
	});

	const source = {
		visible: true,
		matrixWorld: matrix(40),
		clone() {
			const clone = {
				isMesh: true,
				visible: true,
				userData: {},
				matrix: matrix(5),
				matrixWorld: matrix(),
				matrixAutoUpdate: true,
				material: {
					roughness: 1,
					clone() { return { roughness: this.roughness, dispose() {} }; },
				},
				traverse(callback) { callback(this); },
				updateMatrix() { this.matrix = matrix(5); },
			};
			return clone;
		},
	};
	globalThis.Canvas = { scene: { updateMatrixWorld() {} } };
	globalThis.Outliner = { elements: [{ mesh: source, parent: { uuid: 'body' } }] };
	PTR.groupOverrides = { body: { roughness: 0.3 } };
	PTR.selectedGroupUuid = null;

	const preview = {
		ownedMaterials: [],
		model: {
			children: [],
			clear() { this.children = []; },
			add(child) { this.children.push(child); },
			updateMatrixWorld() {
				for (const child of this.children) {
					if (child.matrixAutoUpdate) child.updateMatrix();
					child.matrixWorld.copy(child.matrix);
				}
			},
		},
		highlightGroup() {},
	};

	RasterPreview.prototype.refreshModel.call(preview);
	const clone = preview.model.children[0];
	assert.equal(clone.matrixAutoUpdate, false);
	assert.equal(clone.matrixWorld.elements[12], 40);
	assert.equal(clone.material.roughness, 0.3);

	source.matrixWorld = matrix(55);
	RasterPreview.prototype.syncModelPose.call(preview);
	assert.equal(clone.matrixWorld.elements[12], 55);
});
