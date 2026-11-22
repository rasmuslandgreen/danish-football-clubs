/**
 * Exports logo frames from the Figma logo file to assets/logos/{dbuId}.png.
 * Replaces the manual "export + compress" step.
 *
 * A frame is exported when it is named by a dbuId, contains an image,
 * and is not awaiting review in logoPlacements.json (status "needs-review",
 * set when Claude places a logo via the Figma MCP; approve with
 * `node scripts/logos/placement.js approve …`).
 *
 * By default only frames for clubs WITHOUT a file in assets/logos/ are exported.
 *
 * Usage:   node scripts/logos/exportFromFigma.js
 * Env:     ONLY_IDS=1,2   ALL=1 (re-export every image frame)   DRY=1 (list only)
 * Needs FIGMA_TOKEN (scope file_content:read) and FIGMA_FILE_KEY in .env.
 * Then:    npm run logos
 */

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { ROOT, LOGOS_DIR, CLUBS_PATH, loadEnv, onlyIds, findFile, sleep, readJson, writeJson } from './lib.js';

const env = loadEnv();
const { FIGMA_TOKEN, FIGMA_FILE_KEY } = env;
if (!FIGMA_TOKEN || !FIGMA_FILE_KEY) { console.error('FIGMA_TOKEN / FIGMA_FILE_KEY missing in .env'); process.exit(1); }

const ids = onlyIds();
const ALL = !!process.env.ALL;
const DRY = !!process.env.DRY;
const OUT_DIR = process.env.OUT_DIR ?? LOGOS_DIR; // e.g. a scratch dir for testing

async function figma(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.figma.com/v1${path}`, { headers: { 'X-Figma-Token': FIGMA_TOKEN } });
    if (res.status === 429 && attempt < 5) { await sleep(2000 * 2 ** attempt); continue; }
    const json = await res.json();
    if (!res.ok || json.err) throw new Error(`Figma ${res.status}: ${json.err ?? json.message ?? JSON.stringify(json)}`);
    return json;
  }
}

const hasImageFill = node =>
  (node.fills ?? []).some(f => f.type === 'IMAGE') || (node.children ?? []).some(hasImageFill);

// ── Find frames ─────────────────────────────────────────────────────────────

const placements = readJson(join(ROOT, 'logoPlacements.json'), {});
const file = await figma(`/files/${FIGMA_FILE_KEY}?depth=3`);
const frames = [];
const logoPage = file.document.children.find(p => p.name === (env.FIGMA_PAGE ?? 'Page 1')) ?? file.document.children[0];
for (const page of [logoPage]) {
  for (const node of page.children ?? []) {
    if (node.type !== 'FRAME' || !/^\d+$/.test(node.name)) continue;
    const dbuId = +node.name;
    const status = placements[dbuId]?.status ?? null;
    // A monogram badge (club colours + letters, no crest found) is a TEXT node named "monogram"
    const monogram = (node.children ?? []).some(c => c.type === 'TEXT' && c.name === 'monogram');
    frames.push({ id: node.id, dbuId, status, monogram, hasImage: hasImageFill(node) || monogram });
  }
}

const review = frames.filter(f => f.status === 'needs-review');
const todo = frames.filter(f =>
  f.hasImage && f.status !== 'needs-review' && f.status !== 'rejected' &&
  (ids ? ids.has(f.dbuId) : ALL || !findFile(LOGOS_DIR, f.dbuId)));

console.log(`Figma file "${file.name}": ${frames.length} club frames, ${frames.filter(f => f.hasImage).length} with a logo, ${review.length} awaiting review`);
console.log(`Exporting ${todo.length} frame(s)${DRY ? ' (dry run)' : ''}…`);
if (DRY) { todo.forEach(f => console.log(`  ${f.dbuId}`)); process.exit(0); }

// ── Export in chunks ────────────────────────────────────────────────────────

let written = 0;
const kinds = new Map(); // dbuId → 'crest' | 'monogram', recorded in clubs.json as logoKind
for (let i = 0; i < todo.length; i += 50) {
  const chunk = todo.slice(i, i + 50);
  const { images } = await figma(`/images/${FIGMA_FILE_KEY}?ids=${chunk.map(f => f.id).join(',')}&format=png&scale=1`);
  for (const f of chunk) {
    const url = images[f.id];
    if (!url) { console.log(`  ✗ ${f.dbuId}: no render`); continue; }
    const raw = Buffer.from(await (await fetch(url)).arrayBuffer());
    // Match the existing library: 500×500, opaque white, palette-quantized PNG
    const png = await sharp(raw)
      .resize(500, 500, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      // 64 colours is visually identical to the hand-compressed logos and ~40% smaller than 256
      .png({ palette: true, quality: 65, colours: 64, dither: 0.8, effort: 10, compressionLevel: 9 })
      .toBuffer();
    // Replace any other format for this id so mergeLogos sees one file
    const old = findFile(LOGOS_DIR, f.dbuId);
    if (OUT_DIR === LOGOS_DIR && old && !old.endsWith('.png')) unlinkSync(old);
    writeFileSync(join(OUT_DIR, `${f.dbuId}.png`), png);
    written++;
    kinds.set(f.dbuId, f.monogram ? 'monogram' : 'crest');
    console.log(`  ✓ ${f.dbuId}.png (${Math.round(png.length / 1024)} KB)`);
  }
}

// Record which logos are monogram badges, so a real crest can replace them later
if (OUT_DIR === LOGOS_DIR && kinds.size) {
  const clubs = readJson(CLUBS_PATH, []);
  for (const c of clubs) if (kinds.has(c.dbuId)) {
    if (kinds.get(c.dbuId) === 'monogram') c.logoKind = 'monogram'; else delete c.logoKind;
  }
  writeJson(CLUBS_PATH, clubs);
}

console.log(`\n✓ ${written} logo(s) written to ${OUT_DIR}.` +
  (OUT_DIR === LOGOS_DIR ? ' Run "npm run logos" to update clubs.json + index.js.' : ''));
