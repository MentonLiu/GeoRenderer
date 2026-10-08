import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMaterials } from '../plugins/georenderer/src/scene/materials.js';
import { DEFAULTS } from '../plugins/georenderer/src/core/config.js';
import { MF_HAS_MER, MF_HAS_EMISSIVE_MAP, MF_FULLBRIGHT, MF_EMIS_CUSTOM_COLOR, MF_EMIS_MAIN_COLOR } from '../plugins/georenderer/src/scene/geometry.js';

function fixture(t, merPixel, emissionPixel) {
	const previous = { document: globalThis.document, Texture: globalThis.Texture };
	t.after(() => Object.assign(globalThis, previous));
	globalThis.document = { createElement() {
		const canvas = { width: 1, height: 1 };
		const pixels = new Map();
		const ctx = {
			fillStyle: '#000000', clearRect() { pixels.clear(); },
			fillRect() {},
			drawImage(image, x, y, w, h) { for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) pixels.set((y + dy) * canvas.width + x + dx, image.pixel); },
			getImageData() {
				const data = new Uint8Array(canvas.width * canvas.height * 4);
				for (const [index, pixel] of pixels) data.set(pixel, index * 4);
				return { data };
			},
		};
		canvas.getContext = () => ctx;
		return canvas;
	} };
	const image = pixel => ({ width: 2, height: 2, pixel });
	const texture = { uuid: 'color', canvas: image([128, 128, 128, 255]), pbr_channel: 'color' };
	const channels = [texture];
	if (merPixel) channels.push({ uuid: 'mer', pbr_channel: 'mer', canvas: image(merPixel) });
	texture.getGroup = () => ({ is_material: !!merPixel, getTextures: () => channels });
	const emission = { uuid: 'emission', canvas: image(emissionPixel || [0, 0, 0, 255]) };
	globalThis.Texture = { all: [...channels, emission] };
	const gl = { getParameter: () => 1024, createTexture: () => ({}), bindTexture() {}, pixelStorei() {}, texImage2D() {}, texParameteri() {} };
	return override => buildMaterials(gl, [texture], [['body']], DEFAULTS, {}, { body: override });
}

test('emission strength preserves MER masks while roughness and metalness retain scalar overrides', t => {
	const build = fixture(t, [128, 0, 255, 255]);
	const material = build({ emissive: 20, roughness: 0, metalness: 1 });
	const flags = material.matData[3];
	assert.ok(flags & MF_HAS_MER);
	assert.equal(flags & 512, 0);
	assert.ok(flags & 1024); assert.ok(flags & 2048);
	assert.equal(material.matData[10], 20);
	assert.equal(material.slotList[0].emissive, false);
});

test('separate emission maps work by default and keep black areas dark at high strength', t => {
	const build = fixture(t, null, [0, 0, 0, 255]);
	const material = build({ emissive_map: 'emission', emissive: 20 });
	assert.ok(material.matData[3] & MF_HAS_EMISSIVE_MAP);
	assert.equal(material.matData[3] & (512 | MF_FULLBRIGHT), 0);
	assert.equal(material.slotList[0].emissive, false);
	assert.equal(build({ emissive_map: 'emission' }).matData[10], 1);
});

test('uniform group emission and its color still work without an emission map', t => {
	const build = fixture(t);
	const material = build({ emissive: 20, emissive_color: '#00ffff' });
	assert.ok(material.matData[3] & MF_FULLBRIGHT);
	assert.equal(material.slotList[0].emissive, true);
	assert.deepEqual(Array.from(material.matData.slice(16, 19)), [0, 1, 1]);
});

test('group emission color sources apply to MER and untextured emission', t => {
	const build = fixture(t, [0, 128, 255, 255]);
	assert.ok(build({ emissive: 20, emissive_color_source: 'custom' }).matData[3] & MF_EMIS_CUSTOM_COLOR);
	assert.ok(build({ emissive: 20, emissive_color_source: 'main' }).matData[3] & MF_EMIS_MAIN_COLOR);
});
