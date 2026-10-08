import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
	stdin: {
		contents: "export { PTR } from './plugins/georenderer/src/ui/state.js'; export { setStep } from './plugins/georenderer/src/ui/window.js'; export { STEPS } from './plugins/georenderer/src/ui/workflow-state.js';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)),
		sourcefile: 'workflow-test-entry.js',
	},
	bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.glsl': 'text' },
});
const { PTR, setStep, STEPS } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

function node() {
	return { style: {}, dataset: {}, classList: { toggle() {} }, setAttribute() {} };
}

test('returning from camera setup resumes rendering and updates the pause button', t => {
	const previous = { ...PTR };
	const previousRequest = globalThis.requestAnimationFrame;
	const previousCancel = globalThis.cancelAnimationFrame;
	t.after(() => {
		Object.assign(PTR, previous);
		globalThis.requestAnimationFrame = previousRequest;
		globalThis.cancelAnimationFrame = previousCancel;
	});
	globalThis.requestAnimationFrame = () => 1;
	globalThis.cancelAnimationFrame = () => {};
	PTR.dialog = {};
	PTR.step = 'preview';
	PTR.paused = true;
	PTR.open = true;
	PTR.settings = { ...PTR.settings, res_mode: 'custom', res_width: 320, res_height: 240, preview_scale: 0.5 };
	PTR.raster = { start() {}, stop() {} };
	PTR.tracer = {
		width: 160, height: 120, spp: 0, env: null, scene: {},
		setCamera() {}, setEnvironment() {}, resize() {}, reset() {},
		buildScene() { return this.scene; },
	};
	PTR.onRenderStatus = null;
	PTR.refreshMaterialList = null;
	PTR.nodes = {
		frame: { ...node(), getBoundingClientRect: () => ({ width: 320, height: 240 }) },
		viewport: { clientWidth: 320, clientHeight: 240 },
		canvas: { ...node(), isConnected: true },
		rasterCanvas: node(), overlay: node(), watermark: node(),
		footer: node(), toolGroup: node(),
		btnStart: node(), btnCopy: node(), btnSave: node(), btnBlockbench: node(), btnPause: node(),
		btnPauseIcon: { textContent: 'play_arrow' }, btnPauseLabel: { textContent: '继续' },
		navButtons: Object.fromEntries(STEPS.map(step => [step.id, node()])),
		stagePanes: Object.fromEntries(STEPS.map(step => [step.id, node()])),
	};

	setStep('camera');
	assert.equal(PTR.open, true);
	assert.equal(PTR.paused, false);
	assert.equal(PTR.nodes.canvas.style.display, 'block');
	assert.equal(PTR.nodes.rasterCanvas.style.display, 'block');
	setStep('preview');
	assert.equal(PTR.open, true);
	assert.equal(PTR.paused, false);
	assert.equal(PTR.nodes.btnPauseIcon.textContent, 'pause');
	assert.equal(PTR.nodes.btnPauseLabel.textContent, '暂停');
	assert.equal(PTR.nodes.rasterCanvas.style.display, 'none');
});
