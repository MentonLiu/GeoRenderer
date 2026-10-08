import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { RenderBuffers } from '../plugins/georenderer/src/gpu/render-buffers.js';
import { makeTilePlan, TiledRender } from '../plugins/georenderer/src/gpu/tiled-render.js';
import { DEFAULTS, MAX_RENDER_BUFFER_SIDE } from '../plugins/georenderer/src/core/config.js';
import { canExport } from '../plugins/georenderer/src/ui/workflow-state.js';

const bundled = await build({
	stdin: { contents: "export { PathTracer } from './plugins/georenderer/src/gpu/path-tracer.js';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
	bundle: true, write: false, platform: 'node', format: 'esm', loader: { '.glsl': 'text' },
});
const { PathTracer } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].contents).toString('base64'));

function gpu({ failTexture = 0, failFramebuffer = 0, nullTexture = 0, nullFramebuffer = 0 } = {}) {
	let id = 0, texturesCreated = 0, framebuffersCreated = 0, pendingError = 0;
	const textures = new Set(), framebuffers = new Set(), images = [];
	return {
		RGBA32F: 1, RGBA16F: 2, RGBA8: 3, R32F: 4, RGBA: 5, RED: 6, FLOAT: 7, UNSIGNED_BYTE: 8,
		FRAMEBUFFER: 9, FRAMEBUFFER_COMPLETE: 10, COLOR_ATTACHMENT0: 100,
		NO_ERROR: 0, OUT_OF_MEMORY: 1285, TEXTURE_2D: 11, COLOR_BUFFER_BIT: 12,
		TIMEOUT_EXPIRED: 13, CONDITION_SATISFIED: 14, WAIT_FAILED: 15, SYNC_GPU_COMMANDS_COMPLETE: 16,
		textures, framebuffers, images, waitStatus: 13, deletedSyncs: [], flushCount: 0,
		createTexture() {
			texturesCreated++;
			if (texturesCreated === nullTexture) return null;
			const texture = { id: ++id }; textures.add(texture); return texture;
		},
		deleteTexture(texture) { textures.delete(texture); },
		bindTexture() {}, texParameteri() {},
		texImage2D(_target, _level, format, width, height, _border, _uploadFormat, type) {
			images.push({ format, width, height, type });
			if (texturesCreated === failTexture) pendingError = 1285;
		},
		getError() { const error = pendingError; pendingError = 0; return error; },
		createFramebuffer() {
			framebuffersCreated++;
			if (framebuffersCreated === nullFramebuffer) return null;
			const fbo = { id: ++id }; framebuffers.add(fbo); return fbo;
		},
		deleteFramebuffer(fbo) { framebuffers.delete(fbo); },
		bindFramebuffer() {}, framebufferTexture2D() {}, drawBuffers() {},
		checkFramebufferStatus() { return framebuffersCreated === failFramebuffer ? 0x8cd6 : 10; },
		getParameter() { return 8192; },
		finish() {}, clearColor() {}, clear() {},
		fenceSync() { return { id: ++id }; },
		deleteSync(sync) { this.deletedSyncs.push(sync); },
		clientWaitSync() { return this.waitStatus; },
		flush() { this.flushCount++; },
	};
}

test('4K and wide final frames retain output size with bounded buffers and filter padding', () => {
	for (const [width, height] of [[4096, 4096], [8192, 2048], [2039, 1173]]) {
		const plan = makeTilePlan(width, height, { ...DEFAULTS, bloom_enable: true, bloom_radius: 10, sharpen_enable: true });
		assert.ok(plan.bufferWidth <= MAX_RENDER_BUFFER_SIDE);
		assert.ok(plan.bufferHeight <= MAX_RENDER_BUFFER_SIDE);
		assert.equal(plan.tiles.reduce((area, tile) => area + tile.width * tile.height, 0), width * height);
		for (const tile of plan.tiles) {
			assert.ok(tile.cropX >= 0 && tile.cropX + tile.width <= plan.bufferWidth);
			assert.ok(tile.cropTop >= 0 && tile.cropTop + tile.height <= plan.bufferHeight);
			assert.ok(tile.originX >= 0 && tile.originY >= 0);
			if (tile.x >= plan.padding) assert.ok(tile.cropX >= plan.padding);
			if (tile.top >= plan.padding) assert.ok(tile.cropTop >= plan.padding);
		}
	}
});

test('final render crops padded tiles in canvas coordinates and unlocks export only after all tiles', () => {
	const copies = [], clears = [];
	const canvas = { getContext: () => ({ drawImage: (...args) => copies.push(args), clearRect: (...args) => clears.push(args) }) };
	const job = new TiledRender(canvas, 2000, 1200, { ...DEFAULTS, final_samples: 16 });
	const tracer = { canvas: {}, spp: 16, reset() { this.spp = 0; } };
	job.startTile(tracer);
	assert.equal(canvas.width, 2000); assert.equal(canvas.height, 1200);
	const first = job.plan.tiles[0];
	job.finishTile(tracer);
	assert.deepEqual(copies[0], [tracer.canvas, first.cropX, first.cropTop, first.width, first.height,
		first.x, first.top, first.width, first.height]);
	assert.equal(job.completed, false);
	assert.equal(canExport('export', true, 16, 16, job.completed), false);
	while (!job.completed) job.finishTile(tracer);
	assert.equal(job.progress(16), 1);
	assert.equal(canExport('export', true, 16, 16, job.completed), true);
	job.updateSamples(32, tracer);
	assert.equal(job.completed, false); assert.equal(job.index, 0); assert.equal(tracer.spp, 0);
	assert.deepEqual(clears.at(-1), [0, 0, 2000, 1200]);
	job.finishTile(tracer);
	job.restart(tracer);
	assert.equal(job.index, 0); assert.equal(job.completed, false); assert.equal(tracer.spp, 0);
	job.dispose();
	assert.equal(canvas.width, 1); assert.equal(canvas.height, 1);
});

test('post buffers allocate on demand, stay under 180 MiB and release resources when disabled', () => {
	const gl = gpu();
	const buffers = new RenderBuffers(gl, 1024, 1024);
	assert.equal(buffers.byteLength, 140 * 1024 * 1024);
	assert.equal(gl.textures.size, 10);
	assert.equal(gl.images.at(-1).format, gl.RGBA8);
	assert.equal(gl.images.at(-1).type, gl.UNSIGNED_BYTE);
	buffers.syncEffects(true, false);
	assert.equal(buffers.byteLength, 164 * 1024 * 1024);
	buffers.syncEffects(true, true);
	assert.equal(buffers.byteLength, 180 * 1024 * 1024);
	assert.equal(gl.textures.size, 16);
	buffers.syncEffects(true, true);
	assert.equal(gl.textures.size, 16);
	buffers.syncEffects(false, false);
	assert.equal(gl.textures.size, 10);
	buffers.dispose();
	assert.equal(gl.textures.size, 0); assert.equal(gl.framebuffers.size, 0);
});

test('allocation failures release partial textures and framebuffers', () => {
	for (const options of [{ failTexture: 5 }, { failFramebuffer: 3 }, { nullTexture: 5 }, { nullFramebuffer: 3 }]) {
		const gl = gpu(options);
		assert.throws(() => new RenderBuffers(gl, 512, 512));
		assert.equal(gl.textures.size, 0); assert.equal(gl.framebuffers.size, 0);
	}
	const gl = gpu({ failTexture: 12 });
	const buffers = new RenderBuffers(gl, 512, 512);
	assert.throws(() => buffers.syncEffects(true, false));
	assert.equal(gl.textures.size, 10);
	buffers.dispose();
	assert.equal(gl.textures.size, 0);
});

test('GPU fences block additional frames and release the completed fence', () => {
	const gl = gpu();
	const tracer = new PathTracer({}); tracer.gl = gl;
	tracer.endFrame();
	assert.equal(gl.flushCount, 1);
	assert.equal(tracer.isFrameReady(), false);
	assert.equal(gl.deletedSyncs.length, 0);
	gl.waitStatus = gl.CONDITION_SATISFIED;
	assert.equal(tracer.isFrameReady(), true);
	assert.equal(gl.deletedSyncs.length, 1);
	assert.equal(tracer.frameSync, null);
});

test('oversized rendering is rejected before allocating GPU resources', () => {
	const gl = gpu();
	const tracer = new PathTracer({}); tracer.gl = gl;
	assert.throws(() => tracer.resize(4096, 4096), /分块/);
	assert.equal(gl.textures.size, 0);
	tracer.resize(512, 512);
	assert.equal(gl.textures.size, 10);
	tracer.resize(512, 512);
	assert.equal(gl.textures.size, 10);
	tracer.resize(768, 768);
	assert.equal(gl.textures.size, 10);
	tracer.disposeBuffers();
	assert.equal(gl.textures.size, 0); assert.equal(gl.framebuffers.size, 0);
});
