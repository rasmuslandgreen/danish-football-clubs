/**
 * Gathers every plausible logo image for clubs in logoQueue.json into
 * assets/logo-candidates/{dbuId}/ and records them in logoCandidates.json.
 *
 * Sources: official DBU crest (dbuLogoIndex.json, from harvestDbuLogos.js),
 * existing assets/logos-raw/, the club website (DBU klubcms footerLogo,
 * JSON-LD, header/nav "logo" images, inline SVG, apple-touch-icon, og:image),
 * and Wikidata P154.
 *
 * Usage:
 *   node scripts/logos/collectCandidates.js
 * Env:
 *   ONLY_IDS=1,2,3   limit to these dbuIds (ignores the queue)
 *   LIMIT=50         only the first N clubs of the queue
 *   FORCE=1          re-collect clubs already in logoCandidates.json
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { extname, join, relative } from 'path';
import * as cheerio from 'cheerio';
import {
  ROOT, RAW_DIR, CANDIDATES_DIR, QUEUE_PATH, CANDIDATES_PATH, USER_AGENT,
  loadClubs, readJson, writeJson, findFile, onlyIds, normaliseName,
  fetchHtml, downloadImage, sleep,
} from './lib.js';

const MAX_PER_CLUB = 8;
const CONCURRENCY  = 4;

const clubs     = loadClubs();
const byId      = new Map(clubs.map(c => [c.dbuId, c]));
const manifest  = readJson(CANDIDATES_PATH, {});
const dbuIndex  = readJson(join(ROOT, 'dbuLogoIndex.json'), {});
const ids       = onlyIds();
const FORCE     = !!process.env.FORCE;
const LIMIT     = parseInt(process.env.LIMIT ?? '0', 10) || Infinity;

let targets = ids
  ? [...ids].map(id => byId.get(id)).filter(Boolean)
  : readJson(QUEUE_PATH, []).map(q => byId.get(q.dbuId)).filter(Boolean);
if (!FORCE) targets = targets.filter(c => !manifest[c.dbuId]);
targets = targets.slice(0, LIMIT);

// ── Website extraction ──────────────────────────────────────────────────────

const LOGO_RE = /logo|brand|emblem|crest|klubmaerke|klubmærke|badge/i;

function srcOf($img) {
  const srcset = $img.attr('srcset') || $img.attr('data-srcset');
  if (srcset) {
    // pick the largest entry
    const best = srcset.split(',').map(s => s.trim().split(/\s+/))
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
    if (best?.[0]) return best[0];
  }
  return $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('src');
}

function extractWebsiteCandidates(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  const add = (source, url) => {
    if (!url || url.startsWith('javascript:')) return;
    try { out.push({ source, url: url.startsWith('data:') ? url : new URL(url, baseUrl).href }); } catch {}
  };

  // DBU klubcms theme
  $('img.footerLogo').each((_, el) => add('dbu-footer', srcOf($(el))));

  // JSON-LD Organization/SportsTeam logo
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const walk = node => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(walk);
        if (node.logo) add('jsonld', typeof node.logo === 'string' ? node.logo : node.logo.url ?? node.logo.contentUrl);
        if (node['@graph']) walk(node['@graph']);
      };
      walk(JSON.parse($(el).text()));
    } catch {}
  });

  // Header / nav images that look like a logo, then any logo-ish image on the page
  $('header img, nav img, [class*="logo" i] img, [id*="logo" i] img, a[class*="brand" i] img').each((_, el) => {
    add('header-img', srcOf($(el)));
  });
  $('img').each((_, el) => {
    const $el = $(el);
    const hay = [$el.attr('class'), $el.attr('id'), $el.attr('alt'), srcOf($el)].join(' ');
    if (LOGO_RE.test(hay)) add('logo-img', srcOf($el));
  });

  // Inline SVG inside a logo container
  $('[class*="logo" i] svg, [id*="logo" i] svg, header a svg').first().each((_, el) => {
    let svg = $.html(el);
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    if (svg.length > 400) add('inline-svg', 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
  });

  // Icons and social images (often the crest on small club sites)
  $('link[rel*="apple-touch-icon" i]').each((_, el) => add('apple-touch-icon', $(el).attr('href')));
  $('link[rel~="icon" i]').each((_, el) => {
    const size = parseInt(($(el).attr('sizes') ?? '').split('x')[0], 10);
    if (size >= 96 || /\.svg/i.test($(el).attr('href') ?? '')) add('icon', $(el).attr('href'));
  });
  add('og-image', $('meta[property="og:image"]').attr('content'));

  return out;
}

// ── Wikidata ────────────────────────────────────────────────────────────────

async function fetchWikidataLogos() {
  const sparql = `SELECT ?itemLabel ?logo WHERE {
    ?item wdt:P31/wdt:P279* wd:Q476028 . ?item wdt:P17 wd:Q35 . ?item wdt:P154 ?logo .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "da,en" } }`;
  const res = await fetch('https://query.wikidata.org/sparql?' + new URLSearchParams({ query: sparql, format: 'json' }), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const map = new Map();
  for (const b of (await res.json()).results.bindings) {
    const name = normaliseName(b.itemLabel?.value ?? '');
    if (name && b.logo?.value && !map.has(name)) map.set(name, b.logo.value);
  }
  return map;
}

// ── Per club ────────────────────────────────────────────────────────────────

async function collect(club, wikidata) {
  const dir = join(CANDIDATES_DIR, String(club.dbuId));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const entry = { name: club.name, website: club.website ?? null, collectedAt: new Date().toISOString(), candidates: [], errors: [] };
  const seen = new Set();
  const push = (source, url, path, bytes) => {
    entry.candidates.push({ id: `c${entry.candidates.length + 1}`, source, url, file: relative(ROOT, path), bytes });
  };

  // 0. Official DBU crest (full resolution) harvested from klubcms match widgets
  for (const file of (dbuIndex[club.dbuId]?.files ?? []).slice(0, 3)) {
    const url = `https://file.dbu.dk/images/club/${club.dbuId}/${encodeURIComponent(file)}`;
    try {
      const { path, bytes } = await downloadImage(url, dir, `c${entry.candidates.length + 1}-dbu`);
      push('dbu', url, path, bytes);
    } catch (e) { entry.errors.push(`dbu: ${e.message}`); }
  }

  // 1. Previously scraped raw file
  const raw = findFile(RAW_DIR, club.dbuId);
  if (raw) {
    const dest = join(dir, `c${entry.candidates.length + 1}-raw${extname(raw)}`);
    copyFileSync(raw, dest);
    push('logos-raw', null, dest, null);
  }

  // 2. Wikidata
  const wd = wikidata.get(normaliseName(club.name));
  if (wd) {
    try {
      // Commons Special:FilePath redirects to the file; ask for a 600px PNG render
      const url = wd.replace('http://', 'https://') + '?width=600';
      const { path, bytes } = await downloadImage(url, dir, `c${entry.candidates.length + 1}-wikidata`);
      push('wikidata', wd, path, bytes);
      seen.add(wd);
    } catch (e) { entry.errors.push(`wikidata: ${e.message}`); }
  }

  // 3. Website
  if (club.website) {
    try {
      const { html, finalUrl } = await fetchHtml(club.website);
      entry.finalUrl = finalUrl;
      const perSource = {};
      for (const { source, url } of extractWebsiteCandidates(html, finalUrl)) {
        if (entry.candidates.length >= MAX_PER_CLUB) break;
        if (seen.has(url)) continue;
        // Other clubs' DBU crests appear in match widgets — only keep our own
        if (/file\.dbu\.dk\/images\/club\/\d+\//.test(url) && !url.includes(`/club/${club.dbuId}/`)) continue;
        if ((perSource[source] = (perSource[source] ?? 0) + 1) > 3) continue;
        seen.add(url);
        try {
          const { path, bytes } = await downloadImage(url, dir, `c${entry.candidates.length + 1}-${source}`);
          push(source, url.startsWith('data:') ? 'inline' : url, path, bytes);
        } catch (e) { entry.errors.push(`${source}: ${e.message}`); }
        await sleep(150);
      }
    } catch (e) { entry.errors.push(`website: ${e.message}`); }
  }

  if (!entry.errors.length) delete entry.errors;
  return entry;
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`Collecting candidates for ${targets.length} clubs…`);
let wikidata = new Map();
try { wikidata = await fetchWikidataLogos(); console.log(`Wikidata: ${wikidata.size} clubs with a logo`); }
catch (e) { console.warn(`Wikidata skipped: ${e.message}`); }

let done = 0, withAny = 0;
const queue = [...targets];
async function worker() {
  while (queue.length) {
    const club = queue.shift();
    const entry = await collect(club, wikidata);
    manifest[club.dbuId] = entry;
    done++;
    if (entry.candidates.length) withAny++;
    console.log(`  ${entry.candidates.length ? '✓' : '–'} [${club.dbuId}] ${club.name}: ${entry.candidates.length} candidate(s)` +
      (entry.errors ? `  (${entry.errors.length} error(s))` : ''));
    if (done % 20 === 0) writeJson(CANDIDATES_PATH, manifest);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeJson(CANDIDATES_PATH, manifest);

console.log(`\n✓ ${done} clubs collected, ${withAny} with at least one candidate → logoCandidates.json`);
