import assert from 'node:assert/strict';
import test from 'node:test';
import { RasterPreview } from '../plugins/georenderer/src/ui/raster-preview.js';
import { PTR } from '../plugins/georenderer/src/ui/state.js';
import { RasterMaterials } from '../plugins/georenderer/src/ui/raster-materials.js';
import { hexToLinear } from '../plugins/georenderer/src/core/math.js';

class Color {
	constructor() { this.set('#ffffff'); }
	set(value) { this.rgb = hexToLinear(value); return this; }
	setRGB(...rgb) { this.rgb = rgb; return this; }
	copy(other) { this.rgb = [...other.rgb]; return this; }
	multiply(other) { this.rgb = this.rgb.map((v, i) => v * other.rgb[i]); return this; }
}

class PreviewTexture {
	constructor(image) { this.image = image; this.version = 0; this.encoding = 3000; this.isTexture = true; }
	clone() { return new PreviewTexture(this.image); }
	set needsUpdate(value) { if (value) this.version++; }
	dispose() { this.disposed = true; }
}

class StandardMaterial {
	constructor() {
		this.isMeshStandardMaterial = true;
		this.color = new Color(); this.emissive = new Color();
		this.normalScale = { setScalar(value) { this.value = value; } };
	}
	dispose() { this.disposed = true; }
}

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
		THREE: globalThis.THREE,
		Texture: globalThis.Texture,
		TextureGroup: globalThis.TextureGroup,
		settings: PTR.settings,
		overrides: PTR.overrides,
		groupOverrides: PTR.groupOverrides,
		selectedGroupUuid: PTR.selectedGroupUuid,
	};
	t.after(() => {
		globalThis.Canvas = previous.Canvas;
		globalThis.Outliner = previous.Outliner;
		globalThis.THREE = previous.THREE;
		globalThis.Texture = previous.Texture;
		globalThis.TextureGroup = previous.TextureGroup;
		PTR.settings = previous.settings;
		PTR.overrides = previous.overrides;
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
	globalThis.THREE = { Color, Texture: PreviewTexture, MeshStandardMaterial: StandardMaterial, MeshPhysicalMaterial: StandardMaterial, sRGBEncoding: 3001, LinearEncoding: 3000, NearestFilter: 1003, LinearFilter: 1006 };
	globalThis.Texture = { all: [] };
	globalThis.TextureGroup = { all: [] };
	PTR.settings = { ...previous.settings, emissive_strength: 1 };
	PTR.overrides = {};
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

test('shader preview uses PBR materials and uploads independent texture copies without changing source textures', t => {
	const texture = new PreviewTexture({ width: 2, height: 2 });
	texture.version = 1;
	const material = shaderMaterial(texture);
	const { preview } = previewFixture(t, material);
	RasterPreview.prototype.refreshModel.call(preview);
	const copy = preview.model.children[0].material;
	assert.notEqual(copy, material);
	assert.equal(copy.isMeshStandardMaterial, true);
	assert.notEqual(copy.map, texture);
	assert.equal(copy.map.image, texture.image);
	assert.ok(copy.map.version > 0);
	assert.equal(copy.map.encoding, THREE.sRGBEncoding);
	assert.equal(material.uniforms.SHADE.value, true);

	RasterPreview.prototype.refreshModel.call(preview);
	assert.equal(copy.disposed, true);
	assert.equal(copy.map.disposed, true);
	assert.equal(preview.model.children[0].material.map.image, texture.image);
	assert.equal(material.disposed, false);
	assert.equal(texture.version, 1);
	assert.equal(texture.encoding, 3000);
});

test('material arrays retain textures and reset to PBR defaults without disposing Blockbench resources', t => {
	const textures = [new PreviewTexture({ width: 2, height: 2 }), new PreviewTexture({ width: 4, height: 4 })];
	const materials = textures.map(shaderMaterial);
	const { preview } = previewFixture(t, materials);
	RasterPreview.prototype.refreshModel.call(preview);
	const copies = preview.model.children[0].material;
	for (const [index, copy] of copies.entries()) assert.equal(copy.map.image, textures[index].image);
	PTR.groupOverrides = {};
	RasterPreview.prototype.refreshModel.call(preview);
	assert.equal(preview.model.children[0].material[0].roughness, PTR.settings.def_roughness);
	assert.equal(preview.model.children[0].material[0].metalness, PTR.settings.def_metalness);
	assert.equal(copies.every(copy => copy.disposed), true);
	assert.equal(materials.some(material => material.disposed), false);
});

test('preview resolves texture, parent and child overrides with independent part emission', t => {
	const source = shaderMaterial(new PreviewTexture({ width: 2, height: 2 }));
	previewFixture(t, source);
	const texture = { uuid: 'skin', getMaterial: () => source };
	Texture.all = [texture];
	PTR.settings.emissive_strength = 0.5;
	const materials = new RasterMaterials(PTR.settings, { skin: { roughness: 0.9, metalness: 0.2 } }, { parent: { metalness: 1, roughness: 0, emissive: 20, emissive_color: '#00ffff' }, child: { roughness: 0.02 } });
	const copy = materials.create(source, ['child', 'parent']);
	assert.equal(copy.roughness, 0.02);
	assert.equal(copy.metalness, 1);
	assert.equal(copy.emissiveIntensity, 20);
	assert.deepEqual(copy.emissive.rgb, [0, 1, 1]);
	assert.equal(copy.emissiveMap, copy.map);
	PTR.settings.emissive_strength = 0;
	assert.equal(materials.create(source, ['child', 'parent']).emissiveIntensity, 20);
	materials.dispose();
});

test('texture overrides and defaults are previewed even without any group override', t => {
	const source = shaderMaterial(new PreviewTexture({ width: 2, height: 2 }));
	const { preview } = previewFixture(t, source, {});
	Texture.all = [{ uuid: 'skin', getMaterial: () => source }];
	PTR.overrides = { skin: { roughness: 0, metalness: 1, emissive: 20 } };
	RasterPreview.prototype.refreshModel.call(preview);
	const copy = preview.model.children[0].material;
	assert.equal(copy.roughness, 0);
	assert.equal(copy.metalness, 1);
	assert.equal(copy.emissiveIntensity, 20);
	PTR.overrides = {};
	PTR.settings.def_roughness = 0.4;
	PTR.settings.def_metalness = 0.6;
	RasterPreview.prototype.refreshModel.call(preview);
	assert.equal(preview.model.children[0].material.roughness, 0.4);
	assert.equal(preview.model.children[0].material.metalness, 0.6);
});

test('MER preview channels are remapped and explicit group parameters take precedence', t => {
	const previousDocument = globalThis.document;
	t.after(() => { globalThis.document = previousDocument; });
	const image = { width: 2, height: 2, pixels: new Uint8ClampedArray(Array(4).fill([255, 128, 0, 255]).flat()) };
	const merImage = { width: 2, height: 2, pixels: new Uint8ClampedArray(Array(4).fill([64, 128, 192, 255]).flat()) };
	const source = shaderMaterial(new PreviewTexture(image));
	previewFixture(t, source);
	globalThis.document = { createElement() {
		const canvas = { width: 2, height: 2 };
		const ctx = {
			drawImage(input) { canvas.pixels = new Uint8ClampedArray(input.pixels); },
			getImageData() { return { data: new Uint8ClampedArray(canvas.pixels) }; },
			putImageData(data) { canvas.pixels = new Uint8ClampedArray(data.data); },
		};
		canvas.getContext = () => ctx;
		return canvas;
	} };
	const color = { uuid: 'color', pbr_channel: 'color', canvas: image, getMaterial: () => source };
	const mer = { uuid: 'mer', pbr_channel: 'mer', canvas: merImage };
	color.getGroup = () => ({ is_material: true, getTextures: () => [color, mer] });
	Texture.all = [color, mer];
	const resources = new RasterMaterials(PTR.settings, {}, {});
	const material = resources.create(source, []);
	assert.equal(material.roughnessMap, material.metalnessMap);
	assert.deepEqual(Array.from(material.roughnessMap.image.pixels.slice(0, 4)), [64, 192, 64, 255]);
	assert.deepEqual(Array.from(material.emissiveMap.image.pixels.slice(0, 4)), [128, 28, 0, 255]);
	assert.equal(material.emissiveMap.encoding, THREE.LinearEncoding);
	resources.groupOverrides.body = { roughness: 0.02, metalness: 1, emissive: 20, emissive_color: '#00ffff' };
	const overridden = resources.create(source, ['body']);
	assert.equal(overridden.roughnessMap, undefined);
	assert.equal(overridden.metalnessMap, undefined);
	assert.deepEqual(Array.from(overridden.emissiveMap.image.pixels.slice(0, 4)), [128, 28, 0, 255]);
	assert.equal(overridden.emissiveIntensity, 20);
	assert.equal(merImage.pixels[1], 128);
	resources.dispose();
});
