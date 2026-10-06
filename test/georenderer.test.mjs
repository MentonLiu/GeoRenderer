import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { DEFAULTS } from '../plugins/georenderer/src/core/config.js';
import { buildBVH } from '../plugins/georenderer/src/scene/bvh.js';
import { packAtlas } from '../plugins/georenderer/src/scene/atlas.js';
import { buildEnvDistribution, generateSkyPixels, parseHDR } from '../plugins/georenderer/src/scene/environment.js';
import { STEPS, canExport, canMoveCamera, isTraceStep, resolveRenderSize, stepIndex, validateFinalSize } from '../plugins/georenderer/src/ui/workflow-state.js';
import { groupChainForElement, materialKey, resolveMaterialOverride } from '../plugins/georenderer/src/scene/group-overrides.js';
import { applyPreset, applyTimeOfDay, formatClock } from '../plugins/georenderer/src/scene/presets.js';
import { RasterPreview } from '../plugins/georenderer/src/ui/raster-preview.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await readFile(path.join(root, 'plugins/georenderer/georenderer.js'), 'utf8');
const rendererBuild = await build({
  stdin: {
    contents: "export { PathTracer } from './plugins/georenderer/src/gpu/path-tracer.js'; export { FS_PATHTRACE_COLOR_ONLY } from './plugins/georenderer/src/gpu/shaders.js';",
    resolveDir: root,
    sourcefile: 'renderer-test-entry.js',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  loader: { '.glsl': 'text' },
});
const { PathTracer, FS_PATHTRACE_COLOR_ONLY } = await import(
  'data:text/javascript;base64,' + Buffer.from(rendererBuild.outputFiles[0].contents).toString('base64')
);

function loadPlugin() {
  let plugin;
  const listeners = new Map();
  const actions = [];
  const css = [];
  const sandbox = {
    window: {},
    Plugin: { register(id, definition) { plugin = { id, ...definition }; } },
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
  return { plugin, listeners, actions, css };
}

test('the original reference remains unchanged', async () => {
  const reference = await readFile(path.join(root, 'reference/pathtracer.js'), 'utf8');
  assert.equal(createHash('sha256').update(reference).digest('hex'), 'b7ac05851ec9550ed9df3769f8b4008f26da1986d1ace7b120969169cdd49886');
});

test('registration and unload remove Blockbench resources', () => {
  const { plugin, listeners, actions, css } = loadPlugin();
  assert.equal(plugin.id, 'georenderer');
  assert.equal(plugin.version, '0.1.1');
  plugin.onload();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'georenderer_open');
  assert.deepEqual([...listeners.keys()], ['finished_edit', 'undo', 'redo', 'update_selection']);
  plugin.onunload();
  assert.equal(actions[0].deleted, true);
  assert.equal(css[0].deleted, true);
  assert.equal(listeners.size, 0);
});

test('workflow exposes five ordered steps and locks the camera during rendering', () => {
  assert.deepEqual(STEPS.map(step => step.id), ['materials', 'scene', 'camera', 'preview', 'export']);
  assert.equal(stepIndex('scene'), 1);
  assert.equal(stepIndex('camera'), 2);
  assert.equal(stepIndex('missing'), -1);
  assert.equal(isTraceStep('camera'), false);
  assert.equal(isTraceStep('scene'), false);
  assert.equal(isTraceStep('preview'), true);
  assert.equal(isTraceStep('export'), true);
  assert.equal(canMoveCamera('materials'), true);
  assert.equal(canMoveCamera('scene'), true);
  assert.equal(canMoveCamera('camera'), true);
  assert.equal(canMoveCamera('preview'), false);
  assert.equal(canMoveCamera('export'), false);
});

test('raster preview click resolves the nearest owning group', t => {
  const previousThree = globalThis.THREE;
  globalThis.THREE = { Vector2: class { constructor(x, y) { this.x = x; this.y = y; } } };
  t.after(() => { globalThis.THREE = previousThree; });
  const raycaster = {
    setFromCamera(point) { assert.equal(point.x, 0); assert.equal(point.y, 0); },
    intersectObjects() { return [{ object: { visible: true, userData: { georendererGroupChain: ['child', 'parent'] } } }]; },
  };
  const preview = {
    activeCamera: { updateMatrixWorld() {} },
    canvas: { getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 100 }; } },
    raycaster,
    model: { children: [{}] },
  };
  assert.equal(RasterPreview.prototype.pickGroup.call(preview, 60, 70), 'child');
});

test('preview resolution is reduced until final render begins', () => {
  const settings = { res_mode: 'custom', res_width: 1280, res_height: 720, preview_scale: 0.5, interactive_scale: 0.25 };
  const viewport = { width: 640, height: 400 };
  assert.deepEqual(resolveRenderSize(settings, 'preview', false, viewport, false), { width: 640, height: 360 });
  assert.deepEqual(resolveRenderSize(settings, 'export', false, viewport, false), { width: 640, height: 360 });
  assert.deepEqual(resolveRenderSize(settings, 'export', true, viewport, false), { width: 1280, height: 720 });
  assert.deepEqual(resolveRenderSize(settings, 'preview', false, viewport, true), { width: 160, height: 90 });
});

test('export actions unlock only after the final sample target is reached', () => {
  assert.equal(canExport('preview', true, 256, 256), false);
  assert.equal(canExport('export', false, 256, 256), false);
  assert.equal(canExport('export', true, 255, 256), false);
  assert.equal(canExport('export', true, 256, 256), true);
});

test('final render size respects framebuffer limits', () => {
  assert.equal(validateFinalSize(4096, 4096, 8192), null);
  assert.match(validateFinalSize(8192, 8192, 8192), /1600 万像素/);
  assert.match(validateFinalSize(9000, 512, 8192), /纹理上限/);
});

test('group material overrides stay distinct when groups share a texture', () => {
  const parent = { uuid: 'outer', parent: null };
  const child = { uuid: 'inner', parent };
  const texture = { uuid: 'shared' };
  const chain = groupChainForElement({ parent: child });
  assert.deepEqual(chain, ['inner', 'outer']);
  assert.notEqual(materialKey(texture, chain), materialKey(texture, ['outer']));
  assert.deepEqual(resolveMaterialOverride(texture, chain,
    { shared: { roughness: 0.7, emissive: 0 } },
    { outer: { roughness: 0.4, metalness: 0.2 }, inner: { roughness: 0.1, emissive: 3 } }),
  { roughness: 0.1, emissive: 3, metalness: 0.2 });
});

test('scene clock maps midday and midnight to sun direction', () => {
  const settings = {};
  assert.equal(applyPreset(settings, 'minecraft_overworld'), true);
  assert.equal(settings.env_mode, 'sky');
  applyTimeOfDay(settings, 12);
  assert.equal(settings.sun_elevation, 70);
  assert.equal(settings.sun_azimuth, 180);
  assert.equal(formatClock(12.25), '12:15');
  applyTimeOfDay(settings, 24);
  assert.equal(settings.sun_enable, false);
  assert.equal(formatClock(24), '24:00');
});

test('nighttime procedural sky emits less light than midday sky', () => {
  const settings = { ...DEFAULTS };
  applyTimeOfDay(settings, 12);
  const noon = generateSkyPixels(settings);
  applyTimeOfDay(settings, 0);
  const midnight = generateSkyPixels(settings);
  const pixel = (256 * 1024 + 512) * 4;
  assert.ok(noon[pixel] > midnight[pixel] * 3);
});

test('Blockbench source modules have no circular or external imports', async () => {
  const result = await build({
    entryPoints: [path.join(root, 'plugins/georenderer/src/index.js')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    loader: { '.css': 'text', '.glsl': 'text' },
    metafile: true,
  });
  const graph = new Map();
  for (const [name, input] of Object.entries(result.metafile.inputs)) {
    for (const dependency of input.imports) assert.notEqual(dependency.external, true);
    graph.set(name, input.imports.map(dependency => dependency.path).filter(dependency => dependency.endsWith('.js')));
  }
  const active = new Set();
  const complete = new Set();
  function visit(name) {
    assert.equal(active.has(name), false, `Circular import at ${name}`);
    if (complete.has(name)) return;
    active.add(name);
    for (const dependency of graph.get(name) || []) visit(dependency);
    active.delete(name);
    complete.add(name);
  }
  for (const name of graph.keys()) visit(name);
});

test('BVH stores a complete triangle permutation and valid root bounds', () => {
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
