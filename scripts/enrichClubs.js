/**
 * Enriches clubs.json with contact info and kit colors from DBU club pages.
 *
 * Adds per club (where available):
 *   email, website, phone
 *   primaryColor, secondaryColor  (from home kit jersey/shorts → hex)
 *   kitHomeJersey, kitHomeShorts, kitHomeSocks
 *   kitAwayJersey,  kitAwayShorts,  kitAwaySocks
 *
 * Safe to re-run — skips clubs already fully enriched, and never overwrites
 * a field that has already been manually set.
 *
 * Usage:
 *   node scripts/enrichClubs.js
 * Then:
 *   npm run build
 */

import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS = 300;
const BASE_URL = 'https://www.dbukoebenhavn.dk';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Danish kit colour → hex ───────────────────────────────────────────────────

const COLOR_MAP = {
  'hvid':       '#ffffff',
  'sort':       '#000000',
  'rød':        '#c8102e',
  'blå':        '#003087',
  'gul':        '#ffd700',
  'grøn':       '#006400',
  'orange':     '#ff6b00',
  'lilla':      '#6f2da8',
  'grå':        '#808080',
  'lyseblå':    '#7ec8e3',
  'mørkblå':    '#001f5b',
  'marineblå':  '#001f5b',
  'bordeaux':   '#800020',
  'lysegrøn':   '#90ee90',
  'lysegrå':    '#d3d3d3',
  'pink':       '#ff69b4',
  'brun':       '#8b4513',
  'beige':      '#f5f5dc',
  'turkis':     '#00ced1',
  'guld':       '#ffd700',
  'sølv':       '#c0c0c0',
};

function toHex(danishColor) {
  if (!danishColor) return null;
  return COLOR_MAP[danishColor.toLowerCase().trim()] ?? null;
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function decodeEntities(str) {
  return str
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&apos;/g,  "'")
    .replace(/&aelig;/g, 'æ').replace(/&Aelig;/g, 'Æ')
    .replace(/&oslash;/g,'ø').replace(/&Oslash;/g,'Ø')
    .replace(/&aring;/g, 'å').replace(/&Aring;/g, 'Å')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCharCode(parseInt(d, 10)));
}

function labelSpan(html, label) {
  const re = new RegExp(`${label}<\\/label>\\s*<span>([^<]*)<\\/span>`, 'i');
  return html.match(re)?.[1]?.trim() ?? null;
}

function parseKitSection(html, sectionLabel) {
  const re = new RegExp(
    `Spilledragt ${sectionLabel}<\\/label>[\\s\\S]*?clothes-box"[\\s\\S]*?` +
    `Tr(?:ø|&#xF8;)je<\\/label>\\s*<span>([^<]*)<\\/span>[\\s\\S]*?` +
    `Shorts<\\/label>\\s*<span>([^<]*)<\\/span>[\\s\\S]*?` +
    `Str(?:ø|&#xF8;mper)<\\/label>\\s*<span>([^<]*)<\\/span>`,
    'i'
  );
  const m = html.match(re);
  if (!m) return null;
  return {
    jersey: m[1].trim() || null,
    shorts: m[2].trim() || null,
    socks:  m[3].trim() || null,
  };
}

function parsePage(rawHtml) {
  const html = decodeEntities(rawHtml);

  // Email — reconstructed from obfuscated data attributes
  const mailMatch = html.match(/data-mail-account="([^"]+)"\s+data-mail-domain="([^"]+)"/);
  const email = mailMatch ? `${mailMatch[1]}@${mailMatch[2]}` : null;

  // Website
  const webMatch = html.match(/Hjemmeside<\/label>\s*<a[^>]+href="([^"]+)"/i);
  const website = webMatch?.[1]?.trim() ?? null;

  // Phone
  const phone = labelSpan(html, 'Telefon');

  // Kit colors
  const home = parseKitSection(rawHtml, 'hjemme');
  const away = parseKitSection(rawHtml, 'ude');

  return {
    email:          email     || null,
    website:        website   || null,
    phone:          phone     || null,
    kitHomeJersey:  home?.jersey ?? null,
    kitHomeShorts:  home?.shorts ?? null,
    kitHomeSocks:   home?.socks  ?? null,
    kitAwayJersey:  away?.jersey ?? null,
    kitAwayShorts:  away?.shorts ?? null,
    kitAwaySocks:   away?.socks  ?? null,
    // Derive primary/secondary from home kit (only if not already set)
    _primaryColor:   toHex(home?.jersey),
    _secondaryColor: toHex(home?.shorts),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));

  let updated = 0;
  let skipped = 0;
  let failed  = 0;

  for (let i = 0; i < clubs.length; i++) {
    const club = clubs[i];

    if (!club.dbuId) { skipped++; continue; }

    // Skip if already fully enriched
    const alreadyDone = club.email !== undefined
      && club.website !== undefined
      && club.kitHomeJersey !== undefined;

    if (alreadyDone) { skipped++; continue; }

    const url = `${BASE_URL}/resultater/klub/${club.dbuId}/klubinfo`;

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) { failed++; await sleep(DELAY_MS); continue; }

      const html   = await resp.text();
      const parsed = parsePage(html);

      // Apply enrichment — never overwrite a manually set primaryColor/secondaryColor
      club.email         = parsed.email;
      club.website       = parsed.website;
      club.phone         = parsed.phone;
      club.kitHomeJersey = parsed.kitHomeJersey;
      club.kitHomeShorts = parsed.kitHomeShorts;
      club.kitHomeSocks  = parsed.kitHomeSocks;
      club.kitAwayJersey = parsed.kitAwayJersey;
      club.kitAwayShorts = parsed.kitAwayShorts;
      club.kitAwaySocks  = parsed.kitAwaySocks;

      if (!club.primaryColor   && parsed._primaryColor)   club.primaryColor   = parsed._primaryColor;
      if (!club.secondaryColor && parsed._secondaryColor) club.secondaryColor = parsed._secondaryColor;

      updated++;
      const hasKit = parsed.kitHomeJersey;
      process.stdout.write(`  [${club.dbuId}] ${club.name}${hasKit ? ` — ${parsed.kitHomeJersey}/${parsed.kitHomeShorts}` : ''}\n`);

    } catch {
      failed++;
      process.stdout.write(`  ✗ [${club.dbuId}] ${club.name}\n`);
    }

    await sleep(DELAY_MS);

    // Save every 50 clubs in case of interruption
    if (i % 50 === 0) writeFileSync('clubs.json', JSON.stringify(clubs, null, 2), 'utf8');
  }

  writeFileSync('clubs.json', JSON.stringify(clubs, null, 2), 'utf8');

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Updated: ${updated}`);
  console.log(`– Skipped: ${skipped}`);
  console.log(`✗ Failed:  ${failed}`);
  console.log(`\nRun 'npm run build' to rebuild index.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
