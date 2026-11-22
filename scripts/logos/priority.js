/**
 * Builds logoQueue.json: every club without a logo, clubs registered in
 * Opstillingen (Supabase user_data.club_name) first, most users first.
 *
 * Usage: node scripts/logos/priority.js
 */

import { loadClubs, hasLogo, fetchRegisteredClubCounts, writeJson, QUEUE_PATH } from './lib.js';

const clubs  = loadClubs();
const counts = await fetchRegisteredClubCounts();

const queue = clubs
  .filter(c => !hasLogo(c.dbuId))
  .map(c => ({ dbuId: c.dbuId, name: c.name, users: counts.get(c.name) ?? 0 }))
  .sort((a, b) => b.users - a.users || a.name.localeCompare(b.name, 'da'));

writeJson(QUEUE_PATH, queue);

const registered      = clubs.filter(c => counts.has(c.name));
const registeredNoLogo = queue.filter(q => q.users > 0);
console.log(`✓ logoQueue.json: ${queue.length} clubs without logo`);
console.log(`  Registered in Opstillingen: ${registered.length} clubs, ${registeredNoLogo.length} without logo`);
for (const q of registeredNoLogo) console.log(`   ${String(q.users).padStart(3)}  ${q.name} (${q.dbuId})`);
