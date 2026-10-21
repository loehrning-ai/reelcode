// server.mjs: a static localhost server for the page (file:// URLs cannot load ES modules).
// Always listen(0) on 127.0.0.1; the resolved path must stay under root.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUDIO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain',
};

export function startServer(root = STUDIO_ROOT) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const f = resolve(base, '.' + pathname);
      if (f !== base && !f.startsWith(base + sep)) { res.writeHead(403); return res.end(); }
      let file = f, st = await stat(file).catch(() => null);
      if (st && st.isDirectory()) { file = resolve(f, 'index.html'); st = await stat(file).catch(() => null); } // capture --routes /x/
      if (!st || !st.isFile()) { res.writeHead(404); return res.end(); }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(400); res.end();
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      ok({ base: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
    });
  });
}
