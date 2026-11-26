/**
 * Review loop for club everyday names.
 *
 *   node scripts/names/reviewNames.js export   → nameReview.csv (only clubs whose suggestion differs
 *                                                 from the official name, least confident first)
 *   node scripts/names/reviewNames.js apply    → reads nameReview.csv and writes `kaldenavn` into clubs.json:
 *                                                 your_name if filled in, otherwise suggested_name.
 *                                                 Write "-" in your_name to give a club no kaldenavn.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT, CLUBS_PATH, readJson } from '../logos/lib.js';

const CSV_PATH = join(ROOT, 'nameReview.csv');
const COLS = ['confidence', 'official_name', 'suggested_name', 'your_name', 'basis', 'dbu_names', 'reason', 'dbuId'];

const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

function parseCsv(text) {
  const rows = []; let row = [], field = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',' || ch === ';') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const cmd = process.argv[2];

if (cmd === 'export') {
  const s = readJson(join(ROOT, 'nameSuggestions.json'), {});
  const rows = Object.entries(s)
    .filter(([, x]) => x.commonName !== x.name)
    .sort((a, b) => a[1].confidence - b[1].confidence);
  const lines = [COLS.join(',')];
  for (const [id, x] of rows) {
    lines.push([Math.round(x.confidence * 100), q(x.name), q(x.commonName), '""', x.basis,
      q((x.dbuNames ?? []).join(' | ')), q(x.reason), id].join(','));
  }
  writeFileSync(CSV_PATH, '﻿' + lines.join('\n') + '\n');
  console.log(`✓ nameReview.csv: ${rows.length} clubs (least confident first)`);
} else if (cmd === 'apply') {
  const [header, ...rows] = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const clubs = readJson(CLUBS_PATH, []);
  const byId = new Map(clubs.map(c => [String(c.dbuId), c]));
  // MIN_CONFIDENCE=70: suggestions below it are not applied (unless you filled in your_name)
  const minConf = parseInt(process.env.MIN_CONFIDENCE ?? '0', 10);
  let set = 0, cleared = 0, overridden = 0, belowMin = 0;
  for (const r of rows) {
    const c = byId.get(r[idx.dbuId]?.trim());
    if (!c) continue;
    const yours = r[idx.your_name]?.trim();
    const conf = parseInt(r[idx.confidence], 10);
    if (!yours && conf < minConf) { belowMin++; if (c.kaldenavn) { delete c.kaldenavn; cleared++; } continue; }
    const name = yours || r[idx.suggested_name]?.trim();
    if (yours) overridden++;
    if (!name || name === '-' || name === c.name) { if (c.kaldenavn) { delete c.kaldenavn; cleared++; } continue; }
    c.kaldenavn = name; set++;
  }
  const raw = readFileSync(CLUBS_PATH, 'utf8');
  writeFileSync(CLUBS_PATH, JSON.stringify(clubs, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  console.log(`✓ kaldenavn set for ${set} clubs (${overridden} from your_name), ${belowMin} below ${minConf}% left as official name, ${cleared} cleared`);
} else {
  console.log('Usage: node scripts/names/reviewNames.js export|apply');
}
