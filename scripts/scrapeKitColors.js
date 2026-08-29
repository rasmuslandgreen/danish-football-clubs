/**
 * Visits each club's DBU page and extracts home kit colours.
 * Trøje (shirt) → primaryColor, Shorts → secondaryColor
 * Updates clubs.json in place, then remind you to run npm run build.
 *
 * Usage:
 *   node scripts/scrapeKitColors.js
 */

import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS = 300;
const SITE     = 'https://www.dbukoebenhavn.dk'; // any regional site works for klubinfo

// Danish colour name → hex
const COLOR_MAP = {
  'sort':        '#000000',
  'hvid':        '#ffffff',
  'rød':         '#cc0000',
  'blå':         '#0055a4',
  'gul':         '#f5d000',
  'grøn':        '#008000',
  'orange':      '#ff6600',
  'lilla':       '#7b2d8b',
  'grå':         '#808080',
  'graa':        '#808080',
  'brun':        '#8b4513',
  'lyseblå':     '#6ab4f5',
  'mørkeblå':    '#003399',
  'marineblå':   '#001f5b',
  'navy':        '#001f5b',
  'lysegrøn':    '#90ee90',
  'mørkegrøn':   '#006400',
  'lysegul':     '#ffff99',
  'mørkerød':    '#8b0000',
  'bordeaux':    '#800020',
  'vinrød':      '#722f37',
  'turkis':      '#40e0d0',
  'pink':        '#ff69b4',
  'sølv':        '#c0c0c0',
  'guld':        '#ffd700',
  'beige':       '#f5f5dc',
  'neongrøn':    '#39ff14',
  'neonorange':  '#ff6700',
  'neongul':     '#ffff00',
  'rødstribet':  '#cc0000',
  'blåstribet':  '#0055a4',
};

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function toHex(danishColor) {
  const key = danishColor.toLowerCase().trim();
  return COLOR_MAP[key] ?? null;
}

function parseKitColors(html) {
  // Find the "Spilledragt hjemme" block
  const hjemmeMatch = html.match(/Spilledragt hjemme[\s\S]*?<div class="clothes-box">([\s\S]*?)<\/div>\s*<\/div>/i);
  if (!hjemmeMatch) return { primaryColor: null, secondaryColor: null };

  const block = hjemmeMatch[1];

  // Extract Trøje and Shorts span values
  const trøjeMatch  = block.match(/<label>Trøje<\/label>\s*<span>(.*?)<\/span>/i);
  const shortsMatch = block.match(/<label>Shorts<\/label>\s*<span>(.*?)<\/span>/i);

  const trøje  = trøjeMatch  ? decodeEntities(trøjeMatch[1]).trim()  : '';
  const shorts = shortsMatch ? decodeEntities(shortsMatch[1]).trim() : '';

  return {
    primaryColor:   toHex(trøje)  ?? null,
    secondaryColor: toHex(shorts) ?? null,
    _trøjeRaw:  trøje,
    _shortsRaw: shorts,
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));
  const todo  = clubs.filter(c => c.dbuId && c.primaryColor === null);

  console.log(`${clubs.length} clubs total, ${todo.length} without a primaryColor — fetching kit colours…\n`);

  let updated  = 0;
  let noData   = 0;
  const unknown = new Set();

  for (const club of todo) {
    const url = `https://www.dbu.dk/resultater/klub/${club.dbuId}/klubinfo`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'danish-football-clubs/1.0 (kit colour scraper)' },
      });

      if (!res.ok) { noData++; await sleep(DELAY_MS); continue; }

      const html   = await res.text();
      const colors = parseKitColors(html);

      if (colors._trøjeRaw && !colors.primaryColor) {
        unknown.add(colors._trøjeRaw);
      }
      if (colors._shortsRaw && !colors.secondaryColor) {
        unknown.add(colors._shortsRaw);
      }

      club.primaryColor   = colors.primaryColor;
      club.secondaryColor = colors.secondaryColor;

      if (colors.primaryColor || colors.secondaryColor) {
        updated++;
        console.log(`  ✓ [${club.dbuId}] ${club.name}  →  ${colors._trøjeRaw || '–'} / ${colors._shortsRaw || '–'}  (${colors.primaryColor ?? '?'} / ${colors.secondaryColor ?? '?'})`);
      } else {
        noData++;
      }
    } catch {
      noData++;
    }

    await sleep(DELAY_MS);
  }

  writeFileSync('clubs.json', JSON.stringify(clubs, null, 2), 'utf8');

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Updated:   ${updated}`);
  console.log(`– No data:   ${noData}`);

  if (unknown.size) {
    console.log(`\nUnknown colour names (not in COLOR_MAP):`);
    [...unknown].sort().forEach(c => console.log(`  "${c}"`));
    console.log(`\nAdd these to COLOR_MAP in scrapeKitColors.js and re-run to fill gaps.`);
  }

  console.log(`\nRun "npm run build" to update index.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
