import assert from 'node:assert/strict';
import test from 'node:test';
import { rowSlider } from '../plugins/georenderer/src/ui/controls.js';
import { buildMaterialList } from '../plugins/georenderer/src/ui/material-panel.js';
import { PTR } from '../plugins/georenderer/src/ui/state.js';

class Node {
	constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.style = {}; }
	setAttribute(key, value) { this[key] = value; }
	appendChild(child) { this.children.push(child); return child; }
	addEventListener(name, callback) { this.events[name] = callback; }
}

function find(node, predicate) {
	if (predicate(node)) return node;
	for (const child of node.children) { const match = find(child, predicate); if (match) return match; }
}

test('default, multiplier and per-texture controls refresh the raster preview before a tracer exists', async t => {
	const saved = { document: globalThis.document, Texture: globalThis.Texture, settings: PTR.settings, overrides: PTR.overrides, nodes: PTR.nodes, raster: PTR.raster, tracer: PTR.tracer, controls: PTR.controls, onSettingChanged: PTR.onSettingChanged };
	t.after(() => {
		clearTimeout(PTR.rasterRefreshTimer); clearTimeout(PTR.rebuildTimer);
		globalThis.document = saved.document; globalThis.Texture = saved.Texture;
		for (const key of ['settings', 'overrides', 'nodes', 'raster', 'tracer', 'controls', 'onSettingChanged']) PTR[key] = saved[key];
	});
	globalThis.document = { createElement: tag => new Node(tag) };
	globalThis.Texture = { all: [{ uuid: 'skin', name: 'skin' }] };
	PTR.settings = { ...saved.settings }; PTR.overrides = {}; PTR.controls = [];
	PTR.nodes = { matlist: new Node('div') }; PTR.tracer = null; PTR.onSettingChanged = null;
	let refreshed = 0;
	PTR.raster = { refreshModel() { refreshed++; } };
	const wait = () => new Promise(resolve => setTimeout(resolve, 85));
	for (const key of ['def_roughness', 'def_metalness', 'emissive_strength']) {
		const row = rowSlider(key, key, 0, 20, 0.1);
		const input = find(row, node => node.type === 'number');
		input.value = '1'; input.events.change();
		await wait();
	}
	assert.equal(refreshed, 3);
	buildMaterialList();
	const number = find(PTR.nodes.matlist, node => node.type === 'number');
	number.value = '0.02'; number.events.change();
	await wait();
	assert.equal(PTR.overrides.skin.roughness, 0.02);
	assert.equal(refreshed, 4);
	const reset = find(PTR.nodes.matlist, node => node.tag === 'button');
	reset.events.click(); await wait();
	assert.equal(refreshed, 5);
	assert.deepEqual(PTR.overrides.skin, {});
});
