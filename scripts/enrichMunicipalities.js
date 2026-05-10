/**
 * Adds a `municipality` field to every club in clubs.json using the DAWA API.
 * Also writes postal-municipalities.json — a static postal code → municipality
 * lookup table used by the findenklub app client-side.
 *
 * Usage:
 *   node scripts/enrichMunicipalities.js
 */

import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS  = 150;
const DAWA_BASE = 'https://api.dataforsyningen.dk/postnumre';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dataForPostal(postal) {
  const url = `${DAWA_BASE}/${postal}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  // A postal code can span multiple municipalities — pick the one with the
  // largest area overlap (first in the DAWA response, already sorted by share).
  const municipality = data.kommuner?.[0]?.navn ?? null;
  // visueltcenter is GeoJSON [lng, lat] — store as [lat, lng]
  const vc = data.visueltcenter;
  const coords = vc ? [vc[1], vc[0]] : null;
  return { municipality, coords };
}

async function main() {
  const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));

  // Collect unique postal codes
  const postalCodes = [...new Set(clubs.map(c => c.postal).filter(Boolean))];
  console.log(`Unique postal codes: ${postalCodes.length}\n`);

  // Build postal → municipality map, calling DAWA once per unique postal
  const postalMap = {};
  let ok = 0, failed = 0;

  for (const postal of postalCodes) {
    try {
      const result = await dataForPostal(postal);
      if (result?.municipality) {
        postalMap[postal] = result;
        ok++;
        process.stdout.write(`  ✓ ${postal} → ${result.municipality}${result.coords ? ` [${result.coords.map(n => n.toFixed(4)).join(', ')}]` : ''}\n`);
      } else {
        failed++;
        process.stdout.write(`  – ${postal}: ingen kommune fundet\n`);
      }
    } catch (err) {
      failed++;
      process.stdout.write(`  ✗ ${postal}: ${err.message}\n`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nPostal codes resolved: ${ok} / ${postalCodes.length}`);

  // Write static lookup table for the app
  writeFileSync('postal-municipalities.json', JSON.stringify(postalMap, null, 2));
  console.log('Wrote postal-municipalities.json');

  // Enrich clubs.json
  let enriched = 0;
  for (const club of clubs) {
    const entry = club.postal ? postalMap[club.postal] : null;
    const muni  = entry?.municipality ?? null;
    if (muni) { club.municipality = muni; enriched++; }
    else delete club.municipality;
  }

  writeFileSync('clubs.json', JSON.stringify(clubs, null, 2));
  console.log(`Enriched ${enriched} / ${clubs.length} clubs with municipality`);
  console.log('\nRun buildMunicipalities.js next.');
}

main().catch(err => { console.error(err); process.exit(1); });
