import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const shader = await readFile(new URL('../plugins/georenderer/src/shaders/pathtrace.frag.glsl', import.meta.url), 'utf8');

// Evaluate the production GLSL expression rather than a second implementation.
const body = shader.match(/float distGGX\([^]*?\) \{([^]*?)\n\}/)[1]
	.replace(/\b(float|vec3)\s+(\w+)\s*=/g, 'const $2 =');
const expression = new Function('N', 'H', 'a', 'dot', 'cross', 'max', 'PI', body);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const distribution = (rough, angle = 0) => expression([0, 0, 1], [Math.sin(angle), 0, Math.cos(angle)], rough * rough, dot, cross, Math.max, Math.PI);

test('GGX retains the theoretical reflection peak at the minimum supported roughness', () => {
	for (const rough of [0.015, 0.02, 0.1, 0.5, 1]) {
		const expected = 1 / (Math.PI * rough ** 4);
		assert.ok(Math.abs(distribution(rough) / expected - 1) < 1e-10);
	}
});

test('GGX stays finite for near mirror and grazing configurations', () => {
	for (const rough of [0.015, 0.02, 0.2, 0.6, 1]) {
		for (const angle of [0, 1e-6, 0.01, 0.5, Math.PI / 2]) {
			const value = distribution(rough, angle);
			assert.ok(Number.isFinite(value) && value > 0);
		}
	}
});
