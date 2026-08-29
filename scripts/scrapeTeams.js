/**
 * Scrapes active team registrations for each club from DBU.
 * Writes teams.json — a map of dbuId → team array.
 *
 * Usage:
 *   node scripts/scrapeTeams.js
 * Then:
 *   node scripts/buildTeams.js
 */

import { readFileSync, writeFileSync } from 'fs';

const DELAY_MS = 350;
const BASE_URL = 'https://www.dbu.dk';

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

// DBU age-group division IDs → U-level labels
const DIVISION_TO_AGE = {
  '35': 'U4', '28': 'U5', '27': 'U6', '26': 'U7', '25': 'U8',
  '24': 'U9', '23': 'U10', '22': 'U11', '21': 'U12', '20': 'U13',
  '19': 'U14', '18': 'U15', '17': 'U16', '16': 'U17', '15': 'U18',
  '30': 'U19', '1':  'Senior',
};

// Birth year from age group (approximate, based on current season)
const currentYear = new Date().getFullYear();
const AGE_TO_BIRTH = {
  'U4': currentYear - 4,  'U5': currentYear - 5,  'U6': currentYear - 6,
  'U7': currentYear - 7,  'U8': currentYear - 8,  'U9': currentYear - 9,
  'U10': currentYear - 10,'U11': currentYear - 11,'U12': currentYear - 12,
  'U13': currentYear - 13,'U14': currentYear - 14,'U15': currentYear - 15,
  'U16': currentYear - 16,'U17': currentYear - 17,'U18': currentYear - 18,
  'U19': currentYear - 19,'Senior': null,
};

function parseTeams(rawHtml) {
  const html = decodeEntities(rawHtml);

  // Find all team rows — each has data-gender and data-division attributes
  const rowRe = /<tr[^>]+data-gender="(\d)"[^>]+data-division="(\d+)"[^>]*>/g;
  const teams = {}; // keyed by "ageGroup|gender" to count duplicates

  let match;
  while ((match = rowRe.exec(html)) !== null) {
    const genderCode = match[1]; // 0 = drenge, 1 = piger
    const divisionId = match[2];

    const ageGroup = DIVISION_TO_AGE[divisionId];
    if (!ageGroup) continue;

    const gender = genderCode === '1' ? 'piger' : 'drenge';
    const key    = `${ageGroup}|${gender}`;

    teams[key] = (teams[key] ?? 0) + 1;
  }

  return Object.entries(teams).map(([key, count]) => {
    const [ageGroup, gender] = key.split('|');
    return {
      ageGroup,
      birthYear: AGE_TO_BIRTH[ageGroup] ?? null,
      gender,
      count,
    };
  }).sort((a, b) => {
    // Sort by age group ascending, then gender
    const order = Object.values(DIVISION_TO_AGE);
    return order.indexOf(a.ageGroup) - order.indexOf(b.ageGroup)
      || a.gender.localeCompare(b.gender);
  });
}

async function main() {
  const copenhagenOnly = process.argv.includes('--copenhagen');

  let allClubs = JSON.parse(readFileSync('clubs.json', 'utf8')).filter(c => c.dbuId);

  if (copenhagenOnly) {
    const { bydel } = JSON.parse(readFileSync('bydel.json', 'utf8'));
    const ids = new Set(Object.values(bydel).flat());
    allClubs = allClubs.filter(c => ids.has(c.dbuId));
    console.log(`--copenhagen: filtering to ${allClubs.length} Copenhagen clubs\n`);
  }

  const clubs = allClubs;

  // Load existing teams.json if it exists (for incremental updates)
  let existing = {};
  try { existing = JSON.parse(readFileSync('teams.json', 'utf8')); } catch {}

  const result  = { ...existing };
  let updated   = 0;
  let empty     = 0;
  let failed    = 0;

  console.log(`Scraping team listings for ${clubs.length} clubs…\n`);

  for (const club of clubs) {
    const url = `${BASE_URL}/resultater/Klub/${club.dbuId}`;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) { failed++; await sleep(DELAY_MS); continue; }

      const html  = await resp.text();
      const teams = parseTeams(html);

      result[club.dbuId] = {
        name:        club.name,
        lastUpdated: new Date().toISOString().slice(0, 10),
        teams,
      };

      if (teams.length > 0) {
        updated++;
        const summary = teams.map(t => `${t.ageGroup} ${t.gender}(${t.count})`).join(', ');
        console.log(`  ✓ [${club.dbuId}] ${club.name}: ${summary}`);
      } else {
        empty++;
      }
    } catch {
      failed++;
    }

    await sleep(DELAY_MS);

    // Save every 100 clubs
    if ((updated + empty + failed) % 100 === 0) {
      writeFileSync('teams.json', JSON.stringify(result, null, 2), 'utf8');
    }
  }

  writeFileSync('teams.json', JSON.stringify(result, null, 2), 'utf8');

  console.log(`\n──────────────────────────────`);
  console.log(`✓ With teams:    ${updated}`);
  console.log(`– No teams:      ${empty}`);
  console.log(`✗ Failed:        ${failed}`);
  console.log(`\nRun 'node scripts/buildTeams.js' to generate teams.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
