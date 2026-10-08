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

function previewFixture(t, material, overrides = { body: { roughness: 0.3 } }) {
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
		material,
		clone() {
			const clone = {
				isMesh: true,
				visible: true,
				userData: {},
				matrix: matrix(5),
				matrixWorld: matrix(),
				matrixAutoUpdate: true,
				material: this.material,
				traverse(callback) { callback(this); },
				updateMatrix() { this.matrix = matrix(5); },
			};
			return clone;
		},
	};
	globalThis.Canvas = { scene: { updateMatrixWorld() {} } };
	globalThis.Outliner = { elements: [{ mesh: source, parent: { uuid: 'body' } }] };
	PTR.groupOverrides = overrides;
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
	return { preview, source };
}

test('raster preview retains source world transforms when refreshing group overrides', t => {
	const material = { roughness: 1, clone() { return { roughness: this.roughness, dispose() {} }; } };
	const { preview, source } = previewFixture(t, material);

	RasterPreview.prototype.refreshModel.call(preview);
	const clone = preview.model.children[0];
	assert.equal(clone.matrixAutoUpdate, false);
	assert.equal(clone.matrixWorld.elements[12], 40);
	assert.equal(clone.material.roughness, 0.3);

	source.matrixWorld = matrix(55);
	RasterPreview.prototype.syncModelPose.call(preview);
	assert.equal(clone.matrixWorld.elements[12], 55);
});

function shaderMaterial(texture) {
	return {
		uniforms: { map: { value: texture }, SHADE: { value: true } },
		disposed: false,
		clone() {
			return {
				uniforms: { map: { value: { ...texture, version: 0 } }, SHADE: { value: true } },
				disposed: false,
				dispose() { this.disposed = true; },
			};
		},
		dispose() { this.disposed = true; },
	};
}

test('group override refresh keeps uploaded shader textures and independent scalar uniforms', t => {
	const texture = { isTexture: true, version: 1 };
	const material = shaderMaterial(texture);
	const { preview } = previewFixture(t, material);
	RasterPreview.prototype.refreshModel.call(preview);
	const copy = preview.model.children[0].material;
	assert.notEqual(copy, material);
	assert.equal(copy.uniforms.map.value, texture);
	assert.equal(copy.uniforms.map.value.version, 1);
	copy.uniforms.SHADE.value = false;
	assert.equal(material.uniforms.SHADE.value, true);

	RasterPreview.prototype.refreshModel.call(preview);
	assert.equal(copy.disposed, true);
	assert.equal(preview.model.children[0].material.uniforms.map.value, texture);
	assert.equal(material.disposed, false);
	assert.equal(texture.version, 1);
});

test('material arrays keep their shader textures after overrides and return to source materials on reset', t => {
	const textures = [{ isTexture: true, version: 1 }, { isTexture: true, version: 2 }];
	const materials = textures.map(shaderMaterial);
	const { preview } = previewFixture(t, materials);
	RasterPreview.prototype.refreshModel.call(preview);
	const copies = preview.model.children[0].material;
	for (const [index, copy] of copies.entries()) assert.equal(copy.uniforms.map.value, textures[index]);
	PTR.groupOverrides = {};
	RasterPreview.prototype.refreshModel.call(preview);
	assert.equal(preview.model.children[0].material, materials);
	assert.equal(copies.every(copy => copy.disposed), true);
	assert.equal(materials.some(material => material.disposed), false);
});
