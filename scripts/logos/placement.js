/**
 * Placement bookkeeping for the Figma step (placing itself is done by Claude
 * through the Figma MCP — see WORKFLOW.md "Logo pipeline").
 *
 *   node scripts/logos/placement.js next [N]        → print the next N clubs ready to place (JSON)
 *   node scripts/logos/placement.js placed 1,2,3    → mark as placed, awaiting review
 *   node scripts/logos/placement.js approve 1,2|all → mark as approved (export picks them up)
 *   node scripts/logos/placement.js reject 1,2      → mark as rejected (won't be offered again)
 *   node scripts/logos/placement.js status          → counts
 *
 * State: logoPlacements.json  { dbuId: { status, at } }
 * The queue order comes from logoQueue.json (registered Opstillingen clubs first).
 */

import { join } from 'path';
import { ROOT, QUEUE_PATH, JUDGEMENTS_PATH, readJson, writeJson, hasLogo } from './lib.js';

export const PLACEMENTS_PATH = join(ROOT, 'logoPlacements.json');

// Box (px, inside a 500×500 frame) per crest shape — keeps the logo inside the circular crop
const BOX = { round: 400, square: 380, shield: 380, other: 400, wordmark: 420 };
const MIN_CONF = 0.6;

const [cmd = 'status', arg] = process.argv.slice(2);
const placements = readJson(PLACEMENTS_PATH, {});
const judgements = readJson(JUDGEMENTS_PATH, {});
const queue      = readJson(QUEUE_PATH, []);
const parseIds   = s => (s ?? '').split(',').map(x => x.trim()).filter(Boolean);
const set = (ids, status) => {
  for (const id of ids) placements[id] = { status, at: new Date().toISOString() };
  writeJson(PLACEMENTS_PATH, placements);
  console.log(`✓ ${ids.length} marked ${status}`);
};

if (cmd === 'next') {
  const n = parseInt(arg ?? '20', 10);
  const out = [];
  for (const q of queue) {
    const j = judgements[q.dbuId];
    if (!j?.prepared || !j.isClubCrest || j.confidence < MIN_CONF) continue;
    if (placements[q.dbuId] || hasLogo(q.dbuId)) continue;
    const box = BOX[j.shape] ?? 400;
    const s = Math.min(box / j.prepared.width, box / j.prepared.height);
    const w = Math.round(j.prepared.width * s), h = Math.round(j.prepared.height * s);
    out.push({
      dbuId: q.dbuId, name: q.name, users: q.users,
      file: j.prepared.file, w, h, x: Math.round((500 - w) / 2), y: Math.round((500 - h) / 2),
      fill: j.background === 'fill' && j.fillColor ? j.fillColor : '#FFFFFF',
      confidence: j.confidence, source: j.source,
    });
    if (out.length >= n) break;
  }
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === 'placed') {
  set(parseIds(arg), 'needs-review');
} else if (cmd === 'approve') {
  set(arg === 'all'
    ? Object.keys(placements).filter(id => placements[id].status === 'needs-review')
    : parseIds(arg), 'approved');
} else if (cmd === 'reject') {
  set(parseIds(arg), 'rejected');
} else {
  const counts = {};
  for (const p of Object.values(placements)) counts[p.status] = (counts[p.status] ?? 0) + 1;
  const ready = queue.filter(q => judgements[q.dbuId]?.prepared && !placements[q.dbuId] && !hasLogo(q.dbuId)).length;
  console.log({ ...counts, readyToPlace: ready, queue: queue.length });
}
