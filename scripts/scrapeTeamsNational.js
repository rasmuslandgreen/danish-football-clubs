/**
 * Scrapes active team registrations for all ~1500 clubs nationally from dbu.dk.
 * Output: teams-national.json — same format as teams.json but full national scope.
 *
 * Usage:
 *   node scripts/scrapeTeamsNational.js
 *
 * A summary is printed at the end showing how many clubs have youth teams —
 * useful for sizing the project scope if expanding beyond Copenhagen.
 */

import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS = 350;
const BASE_URL = 'https://www.dbu.dk';
const OUT_FILE = 'teams-national.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(str) {
  return str
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&aelig;/g, 'æ').replace(/&Aelig;/g, 'Æ')
    .replace(/&oslash;/g,'ø').replace(/&Oslash;/g,'Ø')
    .replace(/&aring;/g, 'å').replace(/&Aring;/g, 'Å')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g,           (_, d) => String.fromCharCode(parseInt(d, 10)));
}

const DIVISION_TO_AGE = {
  '35': 'U4',  '28': 'U5',  '27': 'U6',  '26': 'U7',  '25': 'U8',
  '24': 'U9',  '23': 'U10', '22': 'U11', '21': 'U12', '20': 'U13',
  '19': 'U14', '18': 'U15', '17': 'U16', '16': 'U17', '15': 'U18',
  '30': 'U19', '1':  'Senior',
};

const YOUTH_GROUPS = new Set([
  'U4','U5','U6','U7','U8','U9','U10','U11',
  'U12','U13','U14','U15','U16','U17','U18','U19',
]);

function parseTeams(rawHtml) {
  const html = decodeEntities(rawHtml);
  const rowRe = /<tr[^>]+data-gender="(\d)"[^>]+data-division="(\d+)"[^>]*>/g;
  const teams = {};

  let match;
  while ((match = rowRe.exec(html)) !== null) {
    const genderCode = match[1];
    const divisionId = match[2];
    const ageGroup   = DIVISION_TO_AGE[divisionId];
    if (!ageGroup) continue;

    const gender = genderCode === '1' ? 'piger' : 'drenge';
    const key    = `${ageGroup}|${gender}`;
    teams[key]   = (teams[key] ?? 0) + 1;
  }

  return Object.entries(teams).map(([key, count]) => {
    const [ageGroup, gender] = key.split('|');
    return { ageGroup, gender, count };
  }).sort((a, b) => {
    const order = Object.values(DIVISION_TO_AGE);
    return order.indexOf(a.ageGroup) - order.indexOf(b.ageGroup)
      || a.gender.localeCompare(b.gender);
  });
}

function hasYouth(teams) {
  return teams.some(t => YOUTH_GROUPS.has(t.ageGroup));
}

async function main() {
  const clubs = JSON.parse(readFileSync('clubs.json', 'utf8')).filter(c => c.dbuId);

  let result = {};
  try { result = JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch {}

  const toScrape = clubs.filter(c => !result[c.dbuId]);
  const already  = clubs.length - toScrape.length;

  console.log(`Total clubs: ${clubs.length}`);
  if (already) console.log(`Already scraped: ${already} — skipping`);
  console.log(`Scraping: ${toScrape.length} clubs…\n`);

  let done = 0, failed = 0;

  for (const club of toScrape) {
    const url = `${BASE_URL}/resultater/Klub/${club.dbuId}`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const teams = parseTeams(await resp.text());
      result[club.dbuId] = {
        name:        club.name,
        lastUpdated: new Date().toISOString().slice(0, 10),
        teams,
      };

      done++;
      if (teams.length) {
        const youth   = teams.filter(t => YOUTH_GROUPS.has(t.ageGroup));
        const summary = youth.length
          ? youth.map(t => `${t.ageGroup} ${t.gender}(${t.count})`).join(', ')
          : '— kun senior';
        console.log(`  ✓ [${club.dbuId}] ${club.name}: ${summary}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ [${club.dbuId}] ${club.name}: ${err.message}`);
    }

    await sleep(DELAY_MS);

    if (done % 100 === 0) {
      writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
      console.log(`\n  — Gemt ved ${done + already} klubber —\n`);
    }
  }

  writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));

  // ── Summary ───────────────────────────────────────────────────────────────────
  const allEntries    = Object.values(result);
  const withYouth     = allEntries.filter(e => hasYouth(e.teams));
  const seniorOnly    = allEntries.filter(e => e.teams.length && !hasYouth(e.teams));
  const noTeams       = allEntries.filter(e => !e.teams.length);

  console.log(`
──────────────────────────────────────────
  Nationale klubber i alt:   ${clubs.length}
  Scraped (denne kørsel):    ${done}
  Fejlede:                   ${failed}

  Med ungdomshold:           ${withYouth.length}
  Kun seniorhold:            ${seniorOnly.length}
  Ingen hold registreret:    ${noTeams.length}
──────────────────────────────────────────
Output: ${OUT_FILE}
`);
}

main().catch(err => { console.error(err); process.exit(1); });
