// IRONHAVEN dev server: serves game/ as static files on http://localhost:8080.
// Usage: node serve.ts [--port N]
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const requested = portIndex === -1 ? 8080 : Number(args[portIndex + 1]);
const port = Number.isInteger(requested) && requested > 0 && requested < 65536 ? requested : 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = resolve(join(root, normalize(p).replace(/^(\.\.[/\\])+/, '')));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); res.end('forbidden'); return; }
    const st = statSync(file);
    if (!st.isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-length': st.size });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
server.listen(port, () => console.log(`IRONHAVEN serving game/ on http://localhost:${port}/`));
