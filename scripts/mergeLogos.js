/**
 * Scans assets/logos/ and updates the logo field in clubs.json
 * for any club whose dbuId matches a filename.
 *
 * Usage:
 *   node scripts/mergeLogos.js
 *
 * Then run:
 *   npm run build
 *
 * Supported formats: .png .jpg .jpeg .svg .webp
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';

const LOGOS_DIR = 'assets/logos';
const SUPPORTED = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp']);

// Read existing clubs
const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));

// Read logo files and build a map of dbuId → file path
const files = readdirSync(LOGOS_DIR);
const logoMap = new Map();

for (const file of files) {
  const dot = file.lastIndexOf('.');
  if (dot === -1) continue;
  const ext = file.slice(dot).toLowerCase();
  if (!SUPPORTED.has(ext)) continue;

  const id = parseInt(file.slice(0, dot), 10);
  if (isNaN(id)) continue;

  logoMap.set(id, `${LOGOS_DIR}/${file}`);
}

// Merge into clubs
let updated = 0;
let cleared = 0;

for (const club of clubs) {
  const path = logoMap.get(club.dbuId) ?? null;

  if (path && club.logo !== path) {
    club.logo = path;
    updated++;
  } else if (!path && club.logo !== null) {
    // Logo file was removed — clear the field
    club.logo = null;
    cleared++;
  }
}

writeFileSync('clubs.json', JSON.stringify(clubs, null, 2), 'utf8');

console.log(`✓ ${updated} logo(s) added/updated`);
if (cleared > 0) console.log(`  ${cleared} logo(s) cleared (file removed)`);
console.log(`  ${logoMap.size} total logo files in ${LOGOS_DIR}/`);
console.log('\nRun "npm run build" to update index.js');
