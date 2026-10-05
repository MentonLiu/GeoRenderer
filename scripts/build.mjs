import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const names = (await readdir(src)).filter(name => /^\d\d-.*\.js$/.test(name)).sort();
if (names.length !== 19) throw new Error(`Expected 19 source parts, found ${names.length}`);

const parts = await Promise.all(names.map(name => readFile(path.join(src, name), 'utf8')));
const bundle = `(function () {\n\t'use strict';\n\n${parts.join('')}})();\n`;
const output = path.join(root, 'georenderer.js');

if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8');
  if (current !== bundle) throw new Error('georenderer.js is out of date; run npm run build');
  console.log('georenderer.js matches src/');
} else {
  await writeFile(output, bundle);
  console.log(`Built georenderer.js from ${names.length} source parts`);
}
