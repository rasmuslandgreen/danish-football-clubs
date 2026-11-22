/**
 * Prepares each judged logo for placement in Figma:
 * rasterize (svg/gif/bmp/ico → png), trim the uniform border, keep transparency,
 * and upscale small images so the crest is crisp in a 400px box.
 *
 * Output: assets/logo-candidates/{dbuId}/prepared.png  (+ "prepared" fields in logoJudgements.json)
 *
 * Usage: node scripts/logos/prepLogo.js      Env: ONLY_IDS=…  MIN_CONFIDENCE=0.6
 */

import { readFileSync } from 'fs';
import { join, relative } from 'path';
import sharp from 'sharp';
import { ROOT, CANDIDATES_DIR, JUDGEMENTS_PATH, readJson, writeJson, onlyIds, hasLogo } from './lib.js';

const TARGET   = 800; // longest side of the prepared PNG
const MIN_CONF = parseFloat(process.env.MIN_CONFIDENCE ?? '0.6');

const judgements = readJson(JUDGEMENTS_PATH, {});
const ids = onlyIds();

export async function prepare(srcFile, outFile) {
  const input = readFileSync(srcFile);
  let img = sharp(input, { density: 600, animated: false, limitInputPixels: false }).ensureAlpha();

  // Trim against the top-left pixel colour (white, transparent or a flat bg)
  img = sharp(await img.png().toBuffer(), { limitInputPixels: false }).trim({ threshold: 12 });
  const trimmed = await img.png().toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;

  const scale = TARGET / Math.max(width, height);
  const out = sharp(trimmed.data, { limitInputPixels: false }).resize({
    width:  Math.round(width * scale),
    height: Math.round(height * scale),
    kernel: scale > 1 ? 'lanczos3' : 'mitchell',
  });
  const info = await out.png({ compressionLevel: 9 }).toFile(outFile);
  return { width: info.width, height: info.height, sourceWidth: width, sourceHeight: height, upscaled: scale > 1 };
}

let done = 0, skipped = 0;
for (const [id, j] of Object.entries(judgements)) {
  if (ids && !ids.has(+id)) continue;
  if (!j.file || !j.isClubCrest || j.confidence < MIN_CONF) { skipped++; continue; }
  const outFile = join(CANDIDATES_DIR, id, 'prepared.png');
  try {
    const r = await prepare(join(ROOT, j.file), outFile);
    j.prepared = { file: relative(ROOT, outFile), ...r };
    done++;
    console.log(`  ✓ [${id}] ${j.name}: ${r.sourceWidth}×${r.sourceHeight} → ${r.width}×${r.height}${r.upscaled ? ' (upscaled)' : ''}${hasLogo(+id) ? '  [already has logo]' : ''}`);
  } catch (e) {
    console.log(`  ✗ [${id}] ${j.name}: ${e.message}`);
  }
}
writeJson(JUDGEMENTS_PATH, judgements);
console.log(`\n✓ ${done} prepared, ${skipped} skipped (no crest or confidence < ${MIN_CONF})`);
