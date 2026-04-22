/**
 * Scrapes all Danish football clubs from the four regional DBU sites.
 *
 * Strategy:
 *   1. For each regional site, open the results page in Playwright and intercept
 *      every JSON network response while interacting with the search UI.
 *   2. If we catch a club-list endpoint, hit it directly for every letter A–Å.
 *   3. If no API is found, fall back to sequential ID enumeration of HTML club pages.
 *
 * Usage:
 *   node scripts/scrapeClubs.js
 *
 * Output:
 *   clubs.json
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const DELAY_MS   = 250;
const ID_START   = 1; // IDs start as low as 35; scan from the beginning
const ID_MAX     = 5000;
const MISS_LIMIT = 500;  // stop after this many consecutive non-club pages

// All four regional DBU sites share the same underlying club database,
// so scraping one is sufficient. Region is derived from "Medlem af" on each club page.
const REGIONS = [
  { label: 'Danmark', site: 'https://www.dbukoebenhavn.dk' },
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzæøå'.split('');

// ── Phase 1: try to sniff a club-list JSON endpoint ──────────────────────────

async function sniffApiEndpoint(page, site) {
  let bestCandidate = null;

  page.on('response', async response => {
    const url = response.url();
    const ct  = response.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;

    try {
      const body = await response.json();

      // Log every JSON response so we can see what the page is calling
      const preview = JSON.stringify(body).slice(0, 120);
      console.log(`  [json] ${url}`);
      console.log(`         ${preview}`);

      const arr = Array.isArray(body)        ? body
                : Array.isArray(body?.data)  ? body.data
                : Array.isArray(body?.clubs) ? body.clubs
                : Array.isArray(body?.items) ? body.items
                : null;

      if (!arr || arr.length === 0) return;

      const first = arr[0];
      const hasName = first.name || first.Name || first.navn || first.Navn
                   || first.clubName || first.ClubName || first.shortName;
      if (hasName) {
        bestCandidate = { url, arr };
        console.log(`  ✓ Club list found at: ${url}  (${arr.length} items)`);
      }
    } catch {
      // body not JSON or already consumed — skip
    }
  });

  await page.goto(`${site}/resultater/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(4000);

  // Try to trigger the club autocomplete by typing into any search-like input
  const inputs = await page.locator('input').all();
  for (const input of inputs) {
    const ph = (await input.getAttribute('placeholder') ?? '').toLowerCase();
    const nm = (await input.getAttribute('name')        ?? '').toLowerCase();
    const id = (await input.getAttribute('id')          ?? '').toLowerCase();
    if (
      ph.includes('klub') || ph.includes('hold') ||
      nm.includes('klub') || nm.includes('hold') ||
      id.includes('klub') || id.includes('hold')
    ) {
      console.log(`  Typing into input: placeholder="${ph}" name="${nm}" id="${id}"`);
      await input.fill('b');
      await page.waitForTimeout(2000);
      break;
    }
  }

  await page.waitForTimeout(2000);
  return bestCandidate;
}

async function fetchAllFromApi(page, endpointUrl) {
  const all  = [];
  const seen = new Set();

  for (const letter of ALPHABET) {
    // Swap the last query-param value for the current letter
    const url = endpointUrl.replace(/([?&]\w+=)[^&]+/, `$1${letter}`);
    try {
      const resp = await page.evaluate(async u => {
        const r = await fetch(u);
        return r.json();
      }, url);

      const arr = Array.isArray(resp)        ? resp
                : Array.isArray(resp?.data)  ? resp.data
                : Array.isArray(resp?.clubs) ? resp.clubs
                : [];

      for (const item of arr) {
        const name = item.name ?? item.Name ?? item.navn ?? item.Navn ?? '';
        if (name && !seen.has(name)) {
          seen.add(name);
          all.push(item);
        }
      }
      process.stdout.write(`  ${letter}(${arr.length}) `);
    } catch {
      process.stdout.write(`  ${letter}(err) `);
    }

    await sleep(DELAY_MS);
  }

  console.log();
  return all;
}

// ── HTML entity decoder ───────────────────────────────────────────────────────

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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g,            (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

// ── Phase 2: enumerate club IDs from server-rendered HTML pages ───────────────

function parseClubPage(rawHtml) {
  const html = decodeEntities(rawHtml);

  // Primary: label/span pattern used by DBU club pages
  const spanMatch  = html.match(/Navn<\/label>\s*<span>([^<]{3,80})<\/span>/i);
  // Fallback A: first <h1>
  const h1Match    = html.match(/<h1[^>]*>\s*([^<]{3,80})\s*<\/h1>/i);
  // Fallback B: page <title>
  const titleMatch = html.match(/<title>\s*([^<|–\-]{3,80}?)\s*(?:[|–\-]|<\/title>)/i);

  const name = (spanMatch?.[1] ?? h1Match?.[1] ?? titleMatch?.[1] ?? '').trim();

  const lc = name.toLowerCase();
  if (!name
    || lc.includes('stillinger')
    || lc.includes('resultater')
    || lc.includes('dbu')
    || /^[A-Z!]+$/.test(name)
    || name.length < 3) {
    return null;
  }

  // Keep efterskole (boarding schools field teams) but drop generic schools
  if (lc.includes('ungdomsskole') || lc.includes('gymnasium')) return null;
  if (lc.includes('skole') && !lc.includes('efterskole')) return null;

  // Extract postal (4-digit) + city — run on decoded HTML so æøå are real chars
  const addrMatch = html.match(/(\d{4})\s+([A-ZÆØÅa-zæøå][A-Za-zæøåÆØÅ\s\-]{2,40})/);
  const postal = addrMatch?.[1] ?? '';
  const city   = addrMatch?.[2]?.trim() ?? '';

  // Extract the club's actual union membership from "Medlem af</label><span>DBU Xxx</span>"
  const memberMatch = html.match(/Medlem af<\/label>\s*<span>([^<]+)<\/span>/i);
  const union = memberMatch?.[1]?.trim() ?? '';

  return { name, postal, city, union };
}

// Map DBU union name → region label used in our schema
function unionToRegion(union) {
  if (/sjælland/i.test(union))      return 'Sjælland';
  if (/jylland/i.test(union))       return 'Jylland';
  if (/fyn/i.test(union))           return 'Fyn';
  if (/københavn/i.test(union))     return 'Hovedstaden';
  if (/lolland/i.test(union))       return 'Sjælland'; // DBU Lolland-Falster → Sjælland
  if (/bornholm/i.test(union))      return 'Bornholm';
  return 'Ukendt';
}

async function enumerateIds(site, region) {
  const clubs  = [];
  let misses   = 0;

  console.log(`  IDs ${ID_START}–${ID_MAX}, stopping after ${MISS_LIMIT} consecutive misses`);

  for (let id = ID_START; id <= ID_MAX; id++) {
    if (misses > MISS_LIMIT) {
      console.log(`  Stopping — ${MISS_LIMIT} consecutive misses at id ${id}`);
      break;
    }

    const url = `${site}/resultater/klub/${id}/klubinfo`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (resp.status === 404) {
        misses++;
        continue;
      }

      const html  = await resp.text();
      const club  = parseClubPage(html);

      if (club) {
        misses = 0;
        club.dbuId  = id;
        club.region = unionToRegion(club.union);
        clubs.push(club);
        console.log(`  [${id}] ${club.name}  — ${club.city} (${club.region})`);
      } else {
        misses++;
      }
    } catch {
      misses++;
    }

    await sleep(DELAY_MS);
  }

  return clubs;
}

// ── Normalise API shape into our club schema ──────────────────────────────────

function normalise(raw, region) {
  return {
    name:   raw.name      ?? raw.Name      ?? raw.navn      ?? raw.Navn      ?? '',
    city:   raw.city      ?? raw.City      ?? raw.by        ?? raw.By        ?? '',
    postal: raw.postal    ?? raw.Postal    ?? raw.postnr    ?? raw.PostNr    ?? '',
    region,
    color:  null,
    logo:   null,
    dbuId:  raw.id        ?? raw.Id        ?? raw.clubId    ?? raw.ClubId    ?? null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const browser  = await chromium.launch({ headless: true });
  const allClubs = [];

  for (const { label, site } of REGIONS) {
    console.log(`\n━━ ${label} (${site}) ━━`);
    const context = await browser.newContext();
    const page    = await context.newPage();

    console.log('Phase 1: sniffing for a club JSON endpoint…');
    const sniffed = await sniffApiEndpoint(page, site);

    if (sniffed) {
      console.log(`API found — querying A–Å…`);
      const raw = await fetchAllFromApi(page, sniffed.url);
      console.log(`  ${raw.length} clubs via API`);
      allClubs.push(...raw.map(r => normalise(r, label)));
      await context.close();
    } else {
      console.log('No club API found — falling back to ID enumeration…');
      await context.close();
      const clubs = await enumerateIds(site, label);
      console.log(`  ${clubs.length} clubs collected`);
      allClubs.push(...clubs);
    }
  }

  await browser.close();

  const seen   = new Set();
  const unique = allClubs.filter(c => {
    if (!c.name || seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  unique.sort((a, b) => a.name.localeCompare(b.name, 'da'));

  writeFileSync('clubs.json', JSON.stringify(unique, null, 2), 'utf8');
  console.log(`\n✓ ${unique.length} unique clubs → clubs.json`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => { console.error(err); process.exit(1); });
