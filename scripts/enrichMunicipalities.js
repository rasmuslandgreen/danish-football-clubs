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
const REVERSE_BASE = 'https://api.dataforsyningen.dk/kommuner/reverse';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dataForPostal(postal) {
  const url = `${DAWA_BASE}/${postal}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  // visueltcenter is GeoJSON [lng, lat] — store as [lat, lng]
  const vc = data.visueltcenter;
  const coords = vc ? [vc[1], vc[0]] : null;

  // Reverse-geocode the visual center to get the municipality that actually
  // contains that point — more reliable than kommuner[0] which is unordered.
  let municipality = null;
  if (vc) {
    const revRes = await fetch(`${REVERSE_BASE}?x=${vc[0]}&y=${vc[1]}`, { signal: AbortSignal.timeout(8000) });
    if (revRes.ok && revRes.status !== 404) {
      const revData = await revRes.json();
      if (!revData.type?.includes('Error')) municipality = revData.navn ?? null;
    }
  }

  if (!municipality) {
    // Visual center may be in water — use the postal code's own name (e.g. "Roskilde")
    // to find the matching entry in kommuner, then fall back to kommuner[0].
    const postalName = data.navn ?? null;
    const kommuner   = data.kommuner ?? [];
    const byName = postalName ? kommuner.find(k => k.navn === postalName) : null;
    municipality = (byName ?? kommuner[0])?.navn ?? null;
  }

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
    club.coords = entry?.coords ?? null;
  }

  writeFileSync('clubs.json', JSON.stringify(clubs, null, 2));
  console.log(`Enriched ${enriched} / ${clubs.length} clubs with municipality`);
  console.log('\nRun buildMunicipalities.js next.');
}

main().catch(err => { console.error(err); process.exit(1); });
