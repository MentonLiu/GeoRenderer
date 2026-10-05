import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await readFile(path.join(root, 'georenderer.js'), 'utf8');

function loadPlugin() {
  let plugin;
  const listeners = new Map();
  const actions = [];
  const css = [];
  const sandbox = {
    window: { __PATHTRACER_TEST__: true },
    BBPlugin: { register(id, definition) { plugin = { id, ...definition }; } },
    Blockbench: {
      addCSS() {
        const handle = { deleted: false, delete() { this.deleted = true; } };
        css.push(handle);
        return handle;
      },
      on(name, callback) { listeners.set(name, callback); },
      removeListener(name, callback) {
        assert.equal(listeners.get(name), callback);
        listeners.delete(name);
      },
    },
    Action: class {
      constructor(id, options) { this.id = id; this.options = options; this.deleted = false; actions.push(this); }
      delete() { this.deleted = true; }
    },
    MenuBar: { addAction() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    cancelAnimationFrame() {},
    clearTimeout() {},
    console,
  };
  vm.runInNewContext(bundle, sandbox, { filename: 'georenderer.js' });
  return { plugin, internals: sandbox.window.__PATHTRACER_INTERNALS__, listeners, actions, css };
}

test('the original reference remains unchanged', async () => {
  const reference = await readFile(path.join(root, 'reference/pathtracer.js'), 'utf8');
  assert.equal(createHash('sha256').update(reference).digest('hex'), 'b7ac05851ec9550ed9df3769f8b4008f26da1986d1ace7b120969169cdd49886');
});

test('registration and unload remove Blockbench resources', () => {
  const { plugin, listeners, actions, css } = loadPlugin();
  assert.equal(plugin.id, 'georenderer');
  assert.equal(plugin.version, '1.5.1');
  plugin.onload();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'georenderer_open');
  assert.deepEqual([...listeners.keys()], ['finished_edit', 'undo', 'redo']);
  plugin.onunload();
  assert.equal(actions[0].deleted, true);
  assert.equal(css[0].deleted, true);
  assert.equal(listeners.size, 0);
});

test('BVH stores a complete triangle permutation and valid root bounds', () => {
  const { buildBVH } = loadPlugin().internals;
  const triangles = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    10, 0, 0, 11, 0, 0, 10, 1, 0,
    20, 0, 0, 21, 0, 0, 20, 1, 0,
  ]);
  const tree = buildBVH(triangles, 3);
  assert.deepEqual([...tree.order].sort(), [0, 1, 2]);
  assert.deepEqual([...tree.nodes.subarray(0, 3)], [0, 0, 0]);
  assert.deepEqual([...tree.nodes.subarray(4, 7)], [21, 1, 0]);
  assert.ok(tree.nodeCount >= 1);
  const empty = buildBVH(new Float32Array(), 0);
  assert.equal(empty.nodeCount, 1);
  assert.equal(empty.order.length, 0);
});

test('texture atlas keeps rectangles in bounds without overlap', () => {
  const { packAtlas } = loadPlugin().internals;
  const packed = packAtlas([[40, 40], [50, 10], [5, 15]], 256);
  assert.ok(packed);
  assert.equal(packed.rects.length, 3);
  for (const a of packed.rects) {
    assert.ok(a.x >= 0 && a.y >= 0);
    assert.ok(a.x + a.w <= packed.size && a.y + a.h <= packed.size);
    for (const b of packed.rects) {
      if (a === b) continue;
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }
  }
  assert.equal(packAtlas([[300, 1]], 256), null);
});

test('Radiance HDR RLE scanline decodes RGBE values', () => {
  const { parseHDR } = loadPlugin().internals;
  const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 8\n');
  const pixels = Uint8Array.from([2, 2, 0, 8, 136, 128, 136, 64, 136, 32, 136, 129]);
  const bytes = new Uint8Array(header.length + pixels.length);
  bytes.set(header);
  bytes.set(pixels, header.length);
  const image = parseHDR(bytes.buffer);
  assert.equal(image.width, 8);
  assert.equal(image.height, 1);
  assert.deepEqual([...image.data.subarray(0, 4)], [1, 0.5, 0.25, 1]);
  assert.deepEqual([...image.data.subarray(28, 32)], [1, 0.5, 0.25, 1]);
});

test('environment distribution produces normalized CDFs', () => {
  const { buildEnvDistribution } = loadPlugin().internals;
  const pixels = new Float32Array(256 * 128 * 4).fill(1);
  const dist = buildEnvDistribution(pixels, 256, 128);
  assert.equal(dist.width, 256);
  assert.equal(dist.height, 128);
  assert.equal(dist.marg[0], 0);
  assert.equal(dist.marg[128], 1);
  for (let y = 0; y < 128; y++) {
    const row = y * 257;
    assert.equal(dist.cond[row], 0);
    assert.equal(dist.cond[row + 256], 1);
    assert.ok(dist.marg[y + 1] >= dist.marg[y]);
  }
});

test('Apple GPU mode selects the color-only path during interaction', () => {
  const { PathTracer, FS_PATHTRACE_COLOR_ONLY, DEFAULTS } = loadPlugin().internals;
  const tracer = new PathTracer({});
  tracer.appleGpuDetected = true;
  assert.equal(DEFAULTS.gpu_profile, 'auto');
  assert.equal(tracer.useAppleGpuPath({ gpu_profile: 'auto' }), true);
  assert.equal(tracer.useAppleGpuPath({ gpu_profile: 'standard' }), false);
  tracer.appleGpuDetected = false;
  assert.equal(tracer.useAppleGpuPath({ gpu_profile: 'auto' }), false);
  assert.equal(tracer.useAppleGpuPath({ gpu_profile: 'apple' }), true);
  assert.match(FS_PATHTRACE_COLOR_ONLY, /#define PTR_COLOR_ONLY 1/);
  assert.match(FS_PATHTRACE_COLOR_ONLY, /#ifndef PTR_COLOR_ONLY\nlayout\(location = 1\)/);
});

test('color-only render pass writes one attachment and skips guide textures', () => {
  const { PathTracer } = loadPlugin().internals;
  const calls = [];
  const gl = {
    FRAMEBUFFER: 1, TEXTURE0: 100, TEXTURE_2D: 2, TRIANGLES: 3,
    bindFramebuffer(...args) { calls.push(['framebuffer', ...args]); },
    invalidateFramebuffer(...args) { calls.push(['invalidate', ...args]); },
    activeTexture(...args) { calls.push(['unit', ...args]); },
    bindTexture(...args) { calls.push(['texture', ...args]); },
    uniform1i(...args) { calls.push(['uniform', ...args]); },
    drawArrays(...args) { calls.push(['draw', ...args]); },
  };
  const tracer = new PathTracer({});
  tracer.gl = gl;
  tracer.scene = {};
  tracer.env = {};
  tracer.buffers = {
    a: { color: 'a-color', albedo: 'a-albedo', normal: 'a-normal', moment: 'a-moment' },
    b: { color: 'b-color', albedo: 'b-albedo', normal: 'b-normal', moment: 'b-moment' },
    fboA: 'full-a', fboColorA: 'color-a',
  };
  tracer.discardAttachments = [['color'], ['color', 'variance'], ['color', 'albedo', 'normal', 'moment']];
  tracer.appleGpuOptimization = true;
  tracer.colorOnlyPass = true;
  tracer.activePT = { uniforms: { uAccum: 'accum', uSeed: 'seed', uReset: 'reset' } };
  tracer.renderPass();
  assert.deepEqual(calls.find(call => call[0] === 'framebuffer'), ['framebuffer', 1, 'color-a']);
  assert.deepEqual(calls.find(call => call[0] === 'invalidate'), ['invalidate', 1, tracer.discardAttachments[0]]);
  assert.deepEqual(calls.filter(call => call[0] === 'texture').map(call => call[2]), ['b-color']);
  assert.equal(tracer.spp, 1);

  calls.length = 0;
  tracer.ping = 0;
  tracer.colorOnlyPass = false;
  tracer.appleGpuOptimization = false;
  tracer.activePT = { uniforms: {
    uAccum: 'accum', uAccumAlb: 'albedo', uAccumNrm: 'normal', uAccumMom: 'moment',
    uSeed: 'seed', uReset: 'reset',
  } };
  tracer.renderPass();
  assert.deepEqual(calls.find(call => call[0] === 'framebuffer'), ['framebuffer', 1, 'full-a']);
  assert.equal(calls.some(call => call[0] === 'invalidate'), false);
  assert.deepEqual(calls.filter(call => call[0] === 'texture').map(call => call[2]),
    ['b-color', 'b-albedo', 'b-normal', 'b-moment']);
});
