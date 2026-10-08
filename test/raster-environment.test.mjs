import assert from 'node:assert/strict';
import test from 'node:test';
import { RasterEnvironment } from '../plugins/georenderer/src/ui/raster-environment.js';
import { DEFAULTS } from '../plugins/georenderer/src/core/config.js';

test('PBR reflection environment is cached and releases only its own textures and targets', t => {
	const previous = globalThis.THREE;
	t.after(() => { globalThis.THREE = previous; });
	const inputs = [], targets = [];
	globalThis.THREE = {
		DataTexture: class {
			constructor(data, width, height) { Object.assign(this, { data, width, height }); }
			dispose() { this.disposed = true; }
		},
		PMREMGenerator: class {
			fromEquirectangular(input) {
				inputs.push(input);
				const target = { texture: {}, dispose() { this.disposed = true; } };
				targets.push(target);
				return target;
			}
			dispose() { this.disposed = true; }
		},
	};
	const settings = { ...DEFAULTS };
	const environment = new RasterEnvironment({});
	const first = environment.sync(settings, null);
	assert.equal(inputs.length, 1);
	assert.equal(inputs[0].width, 256);
	assert.equal(inputs[0].disposed, true);
	assert.equal(environment.sync(settings, null), first);
	settings.env_intensity = 2;
	assert.equal(environment.sync(settings, null), first);
	settings.env_rotation = 90;
	assert.notEqual(environment.sync(settings, null), first);
	assert.equal(targets[0].disposed, true);
	settings.env_mode = 'image';
	const custom = { width: 2, height: 1, data: new Float32Array([1, 0, 0, 1, 0, 0, 1, 1]) };
	environment.sync(settings, custom);
	assert.equal(environment.sync(settings, custom), targets[2].texture);
	assert.equal(inputs.length, 3);
	assert.ok(inputs[2].data.some(v => v > 0));
	environment.dispose();
	assert.equal(targets[2].disposed, true);
	assert.equal(environment.pmrem.disposed, true);
});
