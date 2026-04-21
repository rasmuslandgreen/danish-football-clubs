/**
 * Reads clubs.json (produced by scrapeClubs.js) and rewrites index.js
 * with the full club list inlined alongside the utility functions.
 *
 * Usage:
 *   node scripts/buildIndex.js
 */

import { readFileSync, writeFileSync } from 'fs';

const raw = JSON.parse(readFileSync('clubs.json', 'utf8'));

// Strip scraper-internal fields; preserve schema used by consuming apps
const clubs = raw.map(({ name, city, postal, region, dbuId, color, logo }) => ({
  name,
  city,
  postal,
  region,
  dbuId:  dbuId  ?? null,
  color:  color  ?? null,
  logo:   logo   ?? null,
}));

const clubsJs = JSON.stringify(clubs, null, 2);

const output = `export const clubs = ${clubsJs};

export function getClub(name) {
  return clubs.find(c => c.name === name)
    || { name, color: '#6b7280', city: '', postal: '', region: '', dbuId: null, logo: null };
}

export function clubInitials(name) {
  const words = name.split(/\\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function clubAbbreviation(name) {
  // Strip parenthetical content and normalize dots in suffixes (G.F. → GF)
  let n = name.trim()
    .replace(/\\s*\\(.*?\\)\\s*/g, ' ')  // remove (...)
    .replace(/\\.(?=[A-ZÆØÅ])/g, '')     // remove dots in abbreviations like G.F. → GF
    .replace(/\\.+$/, '')                // strip trailing dots
    .trim();

  const words = n.split(/\\s+/);
  const first = n[0]?.toUpperCase() ?? '';

  // Already a short acronym (OB, AB, AGF) — keep as-is
  if (words.length === 1 && n.length <= 4) return n.toUpperCase();

  // Single long word — first 3 letters
  if (words.length === 1) return n.slice(0, 3).toUpperCase();

  // FC prefix: FC København → FCK
  const fcMatch = n.match(/^FC\\s+(\\S)/i);
  if (fcMatch) return 'FC' + fcMatch[1].toUpperCase();

  // Boldklubben prefix: Boldklubben Vestia → BKV
  const boldMatch = n.match(/^Boldklubben\\s+(\\S)/i);
  if (boldMatch) return 'BK' + boldMatch[1].toUpperCase();

  // Numbered clubs — letter prefix + number, optional comma+city: B 1909 → B1909, BK 96, Solrød → BK96
  const numMatch = n.match(/^([A-ZÆØÅa-zæøå]{1,4})\\s+(\\d+)(?:[,\\s].*)?$/);
  if (numMatch) return numMatch[1].toUpperCase() + numMatch[2];

  // BK prefix — only if followed by a letter (not a digit): BK Skjold → BKS
  const bkMatch = n.match(/^BK\\s+([A-ZÆØÅa-zæøå])/i);
  if (bkMatch) return 'BK' + bkMatch[1].toUpperCase();

  // Suffix rules — longest first to avoid partial matches (GIF before IF)
  for (const suffix of ['GIF', 'GF', 'GI', 'IF', 'IK', 'SK', 'BK']) {
    if (new RegExp('\\\\b' + suffix + '\\\\s*$', 'i').test(n)) {
      return first + suffix;
    }
  }

  // Fallback: initials of first 3 words, skipping pure numbers
  return words.filter(w => /[a-zæøå]/i.test(w)).slice(0, 3).map(w => w[0].toUpperCase()).join('');
}

export function clubBadgeSvg(name) {
  const abbr = clubAbbreviation(name);
  // Scale font down for longer abbreviations so they fit the circle
  const size = abbr.length <= 2 ? 42
             : abbr.length === 3 ? 36
             : abbr.length === 4 ? 29
             : 23;
  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="#ebebeb"/>
  <text x="50" y="50" dy="0.36em" text-anchor="middle"
    font-family="system-ui,-apple-system,sans-serif"
    font-size="\${size}" font-weight="600" fill="#6b7280">\${abbr}</text>
</svg>\`;
}

export function clubBadgeUrl(name) {
  return 'data:image/svg+xml,' + encodeURIComponent(clubBadgeSvg(name));
}

export function getULevel(birthYear) {
  const age = new Date().getFullYear() - birthYear;
  if (age <= 7)  return 'U7';
  if (age <= 10) return 'U10';
  if (age <= 12) return 'U12';
  return 'U13+';
}

export function getMatchFormat(birthYear) {
  const age = new Date().getFullYear() - birthYear;
  if (age <= 7)  return '3v3';
  if (age <= 10) return '5v5';
  if (age <= 12) return '8v8';
  return '11v11';
}
`;

writeFileSync('index.js', output, 'utf8');
console.log(`✓ index.js written with ${clubs.length} clubs`);
