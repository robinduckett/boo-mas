// OPTIONAL production build: bundles + minifies the game into dist/ (one JS file, tree-shaken three.js).
// The game runs fine without this — it's plain ES modules — but a single small file loads faster.
//   npm run build        (fetches esbuild via npx, so it needs network access the first time)
// NOTE: this script was written but not run during development; treat it as a starting point.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

execFileSync(
  'npx',
  [
    '--yes', 'esbuild', 'src/main.js',
    '--bundle', '--format=esm', '--minify', '--target=es2020', '--legal-comments=linked',
    '--alias:three=./vendor/three/three.module.js',
    '--outfile=dist/main.js',
  ],
  { cwd: root, stdio: 'inherit' }
);

// index.html without the import map, pointing at the bundle
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('src="src/main.js"', 'src="main.js"');
writeFileSync(join(dist, 'index.html'), html);
cpSync(join(root, 'css'), join(dist, 'css'), { recursive: true });
cpSync(join(root, 'assets'), join(dist, 'assets'), { recursive: true });

const js = readFileSync(join(dist, 'main.js'));
console.log(`dist/main.js  ${(statSync(join(dist, 'main.js')).size / 1024).toFixed(0)} kB  (${(gzipSync(js).length / 1024).toFixed(0)} kB gzipped)`);
