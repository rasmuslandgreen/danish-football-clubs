/**
 * Scrapes the Copenhagen neighbourhood (bydel) groupings from DBU København.
 * Writes bydel.json — a map of bydel name → array of dbuIds.
 *
 * Source: https://www.dbukoebenhavn.dk/spillere/boernefodbold/klubber-med-boernefodbold/
 *
 * Usage:
 *   node scripts/scrapeBydel.js
 * Then:
 *   node scripts/buildBydel.js
 */

import { readFileSync, writeFileSync } from 'fs';

const URL = 'https://www.dbukoebenhavn.dk/spillere/boernefodbold/klubber-med-boernefodbold/';

function decodeEntities(str) {
  return str
    .replace(/&amp;/g,   '&')
    .replace(/&aelig;/g, 'æ').replace(/&Aelig;/g, 'Æ')
    .replace(/&oslash;/g,'ø').replace(/&Oslash;/g,'Ø')
    .replace(/&aring;/g, 'å').replace(/&Aring;/g, 'Å')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCharCode(parseInt(d, 10)));
}

// Manual overrides where DBU page name doesn't match clubs.json name
const OVERRIDES = {
  'bk fix':          1599,
  'bk stefan':       1582,
  'bk skjold':       1581,
  'boldklubben 1950': null, // not in dataset — small Copenhagen club
  'bk fremad amager': 1553,
  'bk fremad valby':       1554,
  'boldklubben hellas':    1561,
  'valby boldklub af 1912': 1587,
};

function normalise(str) {
  return str.toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[.\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandName(norm) {
  // Try BK X → Boldklubben X
  if (norm.startsWith('bk ')) return 'boldklubben ' + norm.slice(3);
  // Try FC X → FC X (no change needed usually)
  return null;
}

async function main() {
  const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));

  // Build normalised name → dbuId lookup
  const nameIndex = {};
  for (const club of clubs) {
    nameIndex[normalise(club.name)] = club.dbuId;
  }

  console.log('Fetching DBU København børnefodbold page…');
  const res  = await fetch(URL, { signal: AbortSignal.timeout(15000) });
  const raw  = await res.text();
  const html = decodeEntities(raw);

  // Extract content between <h1> and footer
  const contentMatch = html.match(/<h1[^>]*>[\s\S]*?(?=<footer|<div class="footer)/i);
  const content = contentMatch?.[0] ?? html;

  const bydel  = {}; // bydel name → [dbuId, ...]
  let current  = null;
  const unmatched = [];

  // Parse <strong> tags as bydel headers, <a> tags as club entries
  const tokenRe = /<strong>([^<]+)<\/strong>|<a[^>]+href="([^"]*)"[^>]*>([^<]+)<\/a>/g;
  let match;

  while ((match = tokenRe.exec(content)) !== null) {
    if (match[1]) {
      // New bydel heading
      current = match[1].trim();
      if (!bydel[current]) bydel[current] = [];
    } else if (match[3] && current) {
      // Club link under current bydel
      const clubName = match[3].trim();
      const norm     = normalise(clubName);
      // Check manual overrides first
      let dbuId = norm in OVERRIDES ? OVERRIDES[norm] : nameIndex[norm];

      if (!dbuId) {
        // Try BK X → Boldklubben X expansion
        const expanded = expandName(norm);
        if (expanded) dbuId = nameIndex[expanded];
      }

      if (dbuId) {
        if (!bydel[current].includes(dbuId)) bydel[current].push(dbuId);
        console.log(`  ✓ ${current} — ${clubName} [${dbuId}]`);
      } else if (norm in OVERRIDES && OVERRIDES[norm] === null) {
        console.log(`  – ${current} — ${clubName} (not in dataset, skipping)`);
      } else {
        unmatched.push(`${current}: ${clubName}`);
        console.log(`  ? ${current} — ${clubName} (no match)`);
      }
    }
  }

  const output = {
    lastUpdated: new Date().toISOString().slice(0, 10),
    bydel,
  };

  writeFileSync('bydel.json', JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n──────────────────────────────`);
  console.log(`✓ ${Object.keys(bydel).length} bydele scraped`);
  console.log(`  ${Object.values(bydel).flat().length} clubs matched`);
  if (unmatched.length) {
    console.log(`? ${unmatched.length} unmatched:`);
    unmatched.forEach(u => console.log(`    ${u}`));
  }
  console.log(`\nRun 'node scripts/buildBydel.js' to generate bydel.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
