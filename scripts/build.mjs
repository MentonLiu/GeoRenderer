import { build, context } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'plugins/georenderer/georenderer.js');
const options = {
  entryPoints: [path.join(root, 'plugins/georenderer/src/index.js')],
  outfile: output,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  charset: 'utf8',
  minify: false,
  legalComments: 'none',
  loader: { '.css': 'text', '.glsl': 'text' },
};

if (process.argv.includes('--check')) {
  const result = await build({ ...options, write: false });
  const current = await readFile(output);
  if (!current.equals(result.outputFiles[0].contents)) {
    throw new Error('Plugin bundle is out of date; run npm run build');
  }
  console.log('Blockbench plugin bundle matches source modules');
} else if (process.argv.includes('--watch')) {
  const watcher = await context(options);
  await watcher.watch();
  console.log('Watching GeoRenderer source; reload the local plugin in Blockbench after changes');
} else {
  await build(options);
  console.log('Built plugins/georenderer/georenderer.js');
}
