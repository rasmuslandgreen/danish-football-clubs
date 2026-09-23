/**
 * Pulls user-contributed kit colours from Supabase and patches clubs.json.
 * User data is treated as authoritative — it overwrites scraped/null values.
 *
 * Usage:
 *   node scripts/syncKitContributions.js
 *
 * Then run: npm run build
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://kcujtswmucgpgavgoglc.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtjdWp0c3dtdWNncGdhdmdvZ2xjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDkxNTMsImV4cCI6MjA5MDU4NTE1M30.jg_a2UqTiI0yQIJTqZTCKU8J5jcWMpcHdh9y9NTXjoc';

async function main() {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

  const { data, error } = await sb
    .from('club_kits')
    .select('club_name, primary_color, secondary_color, kit_style, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }

  if (!data.length) {
    console.log('No kit contributions found.');
    return;
  }

  // Contributions marked "Ikke relevant" in the editor are ignored.
  const reviews = existsSync('kitContributionReviews.json')
    ? JSON.parse(readFileSync('kitContributionReviews.json', 'utf8'))
    : {};

  // Most recent contribution per club wins.
  const byClub = new Map();
  for (const row of data) {
    if (reviews[`${row.club_name}|${row.updated_at}`] === 'rejected') continue;
    if (!byClub.has(row.club_name)) byClub.set(row.club_name, row);
  }

  const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));

  let updated = 0;
  let unmatched = [];

  for (const [clubName, row] of byClub) {
    const club = clubs.find(c => c.name === clubName);
    if (!club) {
      unmatched.push(clubName);
      continue;
    }

    if (club.kitLocked) continue;

    let changed = false;
    if (row.primary_color)   { club.primaryColor   = row.primary_color;   changed = true; }
    if (row.secondary_color) { club.secondaryColor = row.secondary_color; changed = true; }
    if (row.kit_style)       { club.kitStyle       = row.kit_style;       changed = true; }

    if (changed) {
      updated++;
      console.log(`  ✓ ${club.name}  →  ${row.primary_color ?? '–'} / ${row.secondary_color ?? '–'}  [${row.kit_style ?? 'plain'}]`);
    }
  }

  writeFileSync('clubs.json', JSON.stringify(clubs, null, 2), 'utf8');

  console.log(`\n──────────────────────────────`);
  console.log(`✓ Updated:    ${updated}`);
  console.log(`– Unmatched:  ${unmatched.length}`);
  if (unmatched.length) {
    console.log(`\nClub names in contributions not found in clubs.json:`);
    unmatched.forEach(n => console.log(`  "${n}"`));
  }
  console.log(`\nRun "npm run build" to update index.js`);
}

main().catch(err => { console.error(err); process.exit(1); });
