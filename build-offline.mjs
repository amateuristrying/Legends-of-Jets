import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root = realpathSync(process.cwd());
const distDir = path.join(root, 'dist');
const outDir = path.join(root, 'play');

// Build production bundle via Vite JS API with canonical root so junctions/symlinks resolve cleanly
await build({
  configFile: false,
  root,
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});

let html = await readFile(path.join(distDir, 'index.html'), 'utf8');

// Inline all stylesheet <link rel="stylesheet" ...> tags
const linkRegex = /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi;
for (const match of [...html.matchAll(linkRegex)]) {
  const href = match[1].replace(/^\.\//, '');
  const css = await readFile(path.join(distDir, href), 'utf8');
  const cleanCss = css.replace(/^@import[^\n]+\n?/gm, '').replace(/<\/style>/gi, '<\\/style>');
  html = html.replace(match[0], () => `<style>\n${cleanCss}\n</style>`);
}

// Inline all module <script type="module" ... src="..."> tags
const scriptRegex = /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
for (const match of [...html.matchAll(scriptRegex)]) {
  const src = match[1].replace(/^\.\//, '');
  const js = await readFile(path.join(distDir, src), 'utf8');
  const safeJs = js.replace(/<\/(script)/gi, '<\\/$1');
  html = html.replace(match[0], () => `<script type="module">\n${safeJs}\n</script>`);
}

await mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, 'Legends of Jets.html');
await writeFile(outFile, html, 'utf8');
console.log(`Offline build written: ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
