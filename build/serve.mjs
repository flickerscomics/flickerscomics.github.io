/* Tiny static server for previewing dist/ locally: npm run serve
   Compresses text files and sets a short cache lifetime, like GitHub Pages does, so speed tests here are realistic. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT) || 8080;
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8" };
const compressible = new Set([".html", ".css", ".js", ".json", ".xml", ".txt"]);

function send(req, res, status, file) {
  const ext = path.extname(file);
  let body = fs.readFileSync(file);
  const headers = { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "max-age=600" };
  if (compressible.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) { body = zlib.gzipSync(body, { level: 6 }); headers["Content-Encoding"] = "gzip"; }
  headers["Content-Length"] = body.length;
  res.writeHead(status, headers).end(body);
}

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(dist, p);
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { const nf = path.join(dist, "404.html"); if (fs.existsSync(nf)) send(req, res, 404, nf); else res.writeHead(404, { "Content-Type": "text/plain" }).end("Not built yet"); return; } // before the first build there is no 404 page either
  send(req, res, 200, file);
}).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}/`));
