// Browser fixture: execute runGPURegression in a WebGL2 host.
import { DEFAULTS } from '../../plugins/georenderer/src/core/config.js';
import { PathTracer } from '../../plugins/georenderer/src/gpu/path-tracer.js';
import { TiledRender } from '../../plugins/georenderer/src/gpu/tiled-render.js';
import { createAtlasTexture, createDataTexture } from '../../plugins/georenderer/src/gpu/webgl.js';
import { buildBVH } from '../../plugins/georenderer/src/scene/bvh.js';
import { MF_HAS_COLOR, MF_FULLBRIGHT, MF_WRAP_REPEAT } from '../../plugins/georenderer/src/scene/geometry.js';

function plane(tracer) {
	const gl = tracer.gl;
	const positions = new Float32Array([-2, -1, 0, 2, -1, 0, 2, 1, 0, -2, -1, 0, 2, 1, 0, -2, 1, 0]);
	const uvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
	const bvh = buildBVH(positions, 2);
	const pos = new Float32Array(24), attr = new Float32Array(32);
	for (let i = 0; i < 2; i++) {
		const triangle = bvh.order[i];
		for (let v = 0; v < 3; v++) {
			pos.set(positions.subarray(triangle * 9 + v * 3, triangle * 9 + v * 3 + 3), i * 12 + v * 4);
			attr[i * 16 + v * 4 + 2] = 1;
		}
		attr[i * 16 + 3] = uvs[triangle * 6];
		attr[i * 16 + 7] = uvs[triangle * 6 + 1];
		attr[i * 16 + 11] = uvs[triangle * 6 + 2];
		attr.set(uvs.slice(triangle * 6 + 3, triangle * 6 + 6), i * 16 + 12);
	}
	const material = new Float32Array([
		1, 1, 1, MF_HAS_COLOR | MF_FULLBRIGHT | MF_WRAP_REPEAT,
		0, 0, 4, 4, 1, 0, 1, 1.5, 0, 0.5, 1, 0, 1, 1, 1, 1,
	]);
	const checker = new Uint8Array(4 * 4 * 4);
	for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
		const index = (y * 4 + x) * 4, color = (x + y) % 2 ? 255 : 16;
		checker.set([color, color, color, 255], index);
	}
	tracer.scene = {
		triCount: 2, lightCount: 0, lightW: 1,
		texTriPos: createDataTexture(gl, pos, 6), texTriAttr: createDataTexture(gl, attr, 8),
		texBVH: createDataTexture(gl, bvh.nodes.subarray(0, bvh.nodeCount * 8), bvh.nodeCount * 2),
		texMat: createDataTexture(gl, material, 5), atlasColor: createAtlasTexture(gl, checker, 4, 4),
	};
	tracer.setCamera({ pos: [0, 0, 4], target: [0, 0, 0], fov: 45, ortho: true, orthoHalfHeight: 1 });
}

async function wait(tracer) {
	const deadline = performance.now() + 15000;
	while (!tracer.isFrameReady()) {
		if (performance.now() > deadline) throw new Error('GPU regression timed out');
		await new Promise(resolve => setTimeout(resolve, 2));
	}
}

async function render(tracer, settings) {
	if (!tracer.beginFrame(settings, false)) throw new Error('GPU frame was not ready');
	for (let i = 0; i < settings.final_samples; i++) tracer.renderPass();
	tracer.present(settings);
	tracer.endFrame();
	await wait(tracer);
	const error = tracer.gl.getError();
	if (error) throw new Error('WebGL regression error: ' + error);
}

function snapshot(source) {
	const canvas = document.createElement('canvas');
	canvas.width = source.width; canvas.height = source.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(source, 0, 0);
	const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
	canvas.width = canvas.height = 1;
	return pixels;
}

export async function runGPURegression() {
	const canvas = document.createElement('canvas'), output = document.createElement('canvas');
	const tracer = new PathTracer(canvas).init();
	const settings = { ...DEFAULTS, env_mode: 'solid', solid_color: '#000000', env_intensity: 0,
		sun_enable: false, ground_on: false, max_bounce: 1, light_samples: 1, clamp_value: 0,
		tone_mapping: 'none', final_samples: 8, denoise_strength: 8, filter_linear: false };
	try {
		plane(tracer);
		tracer.setEnvironment(settings, null);
		tracer.resize(160, 128);
		await render(tracer, { ...settings, denoise: false });
		const raw = snapshot(canvas);
		tracer.present(settings);
		const denoised = snapshot(canvas);
		let detailDifference = 0;
		for (let i = 0; i < raw.length; i++) detailDifference = Math.max(detailDifference, Math.abs(raw[i] - denoised[i]));
		if (detailDifference > 2) throw new Error('Denoising softened checker texture: ' + detailDifference);
		const effects = { ...settings, bloom_enable: true, bloom_threshold: 0.4, bloom_radius: 2,
			vignette_enable: true, vignette_strength: 0.6, sharpen_enable: true, grain_enable: true, grain_strength: 0.02 };
		tracer.reset();
		await render(tracer, effects);
		const reference = snapshot(canvas);
		const job = new TiledRender(output, 160, 128, effects, 112);
		tracer.resize(job.plan.bufferWidth, job.plan.bufferHeight);
		job.startTile(tracer);
		while (!job.completed) { await render(tracer, effects); job.finishTile(tracer); }
		const tiled = snapshot(output);
		let tileDifference = 0;
		for (let i = 0; i < reference.length; i++) tileDifference = Math.max(tileDifference, Math.abs(reference[i] - tiled[i]));
		if (tileDifference > 2) throw new Error('Tiled postprocessing seam: ' + tileDifference);
		const largeSettings = { ...settings, denoise: false, final_samples: 1 };
		const large = new TiledRender(output, 4096, 4096, largeSettings);
		tracer.resize(large.plan.bufferWidth, large.plan.bufferHeight);
		large.startTile(tracer);
		let peakBytes = 0;
		while (!large.completed) {
			await render(tracer, largeSettings);
			peakBytes = Math.max(peakBytes, tracer.buffers.byteLength);
			large.finishTile(tracer);
		}
		if (output.width !== 4096 || output.height !== 4096) throw new Error('Final output dimensions changed');
		return { detailDifference, tileDifference, seamTiles: job.plan.tiles.length,
			finalSize: [output.width, output.height], finalTiles: large.plan.tiles.length,
			peakRenderBuffersMiB: peakBytes / 1024 / 1024, renderer: tracer.appleGpuDetected ? 'Apple GPU' : 'WebGL2' };
	} finally {
		tracer.dispose();
		canvas.width = canvas.height = output.width = output.height = 1;
	}
}
