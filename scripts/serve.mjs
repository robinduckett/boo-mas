// A tiny static file server for playing Boo-mas locally. No dependencies.
//
//   npm start            → http://localhost:8000   (this computer only)
//   npm run start:lan    → also reachable from other devices on your network, e.g. a phone on the
//                          same Wi-Fi; it prints the address to open
//   node scripts/serve.mjs [port] [--lan]
//
// Any static server will do instead (python3 -m http.server, etc). This one exists because the game
// is a couple of dozen separate module files requested at once, and it answers them all reliably;
// it also tells the browser to re-check files on every load, so an edit is never hidden by a cache.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const lan = args.includes('--lan');
const port = +args.find((a) => /^\d+$/.test(a)) || +process.env.PORT || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const send = (res, code, text) => {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  // only files inside this folder, and nothing hidden (.git, .env and friends)
  let file = normalize(join(root, path));
  if ((file !== root && !file.startsWith(root + sep)) || path.split('/').some((part) => part.startsWith('.'))) return send(res, 404, 'Not found');
  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) { file = join(file, 'index.html'); st = statSync(file); }
  } catch {
    return send(res, 404, 'Not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try: node scripts/serve.mjs ${port + 1}` : String(err));
  process.exit(1);
});

server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Boo-mas is at  http://localhost:${port}`);
  if (lan) {
    const addrs = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
    for (const a of addrs) console.log(`on your network  http://${a}:${port}   (anything on this network can load the game folder while this runs)`);
    if (!addrs.length) console.log('(no network address found: is Wi-Fi on?)');
  } else {
    console.log('To play on a phone on the same Wi-Fi:  npm run start:lan');
  }
});
