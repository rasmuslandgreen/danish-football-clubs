/**
 * Suggests an everyday name ("kaldenavn") for every club from the signals we
 * have, using Claude (text only, Message Batches API).
 *
 * Signals per club:
 *   - official DBU name, town
 *   - DBU team names from match widgets (dbuTeamNames.json, cleaned + counted)
 *   - website and email domains (e.g. bkhekla.dk, vanloeseif.dk)
 *   - existing kaldenavn / abbreviation / aliases in clubs.json
 *
 * Output: nameSuggestions.json { dbuId: { name, commonName, confidence, basis, reason } }
 *
 * Usage: node scripts/names/suggestNames.js            (Batches API; resumes a pending batch)
 * Env:   ONLY_IDS=1,2  LIMIT=20  DIRECT=1 (no batch, for small tests)  FORCE=1
 */

import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { ROOT, loadClubs, loadEnv, readJson, writeJson, onlyIds, sleep } from '../logos/lib.js';

const MODEL       = 'claude-opus-5-5';
const OUT_PATH    = join(ROOT, 'nameSuggestions.json');
const BATCH_STATE = join(ROOT, 'nameSuggestBatch.json');

const env = loadEnv();
if (!env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing in .env'); process.exit(1); }
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const clubs      = loadClubs();
const teamNames  = readJson(join(ROOT, 'dbuTeamNames.json'), {});
const out        = readJson(OUT_PATH, {});
const ids        = onlyIds();
const LIMIT      = parseInt(process.env.LIMIT ?? '0', 10) || Infinity;

const FREE_MAIL = /gmail|hotmail|yahoo|live\.|outlook|mail\.dk|jubii|icloud|me\.com|privat|post\.tele|stofanet|webspeed|youmail|ofir|tdcadsl|get2net|city\.dk|forum\.dk|dbu\.dk|dgi\.dk/i;
const NOISE     = /^(nyheder|kampe|resultat|stilling|tabel|hold|program|læs mere|se alle)/i;

/** Cleans raw widget names: drops team numbers "(3)", age groups, gender words. Returns [[name, count]]. */
export function cleanTeamNames(raw = {}) {
  const agg = new Map();
  for (const [n, k] of Object.entries(raw)) {
    if (/[<>{}]/.test(n)) continue;                 // HTML fragments
    let s = n.replace(/\s*\([^)]*\)\s*/g, ' ')      // "(2)", "(Liga 3)", "(Øst 2)"
      .replace(/\b(U\s?\d{1,2}|Senior|Old ?boys|Oldgirls|Veteran|Kvinder|Herrer|Damer|Drenge|Piger|Mix|Futsal)\b.*$/i, '')
      .replace(/\s+\d{1,2}$/, '')              // "B 1903 1" → "B 1903"
      .replace(/\s+/g, ' ').trim();
    if (!s || NOISE.test(s) || s.length < 2) continue;
    agg.set(s, (agg.get(s) ?? 0) + k);
  }
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, 5);
}

const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

function signals(c) {
  const email = c.email?.split('@')[1]?.toLowerCase();
  return [
    `Official DBU name: ${c.name}`,
    `Town: ${c.city ?? '?'}`,
    `DBU team names seen in fixtures/tables (name × times): ${cleanTeamNames(teamNames[c.dbuId]).map(([n, k]) => `"${n}" ×${k}`).join(', ') || 'none'}`,
    `Website domain: ${domainOf(c.website) ?? 'none'}`,
    `Email domain: ${email && !FREE_MAIL.test(email) ? email : 'none/free mail'}`,
    c.kaldenavn ? `Existing nickname: ${c.kaldenavn}` : null,
    c.abbreviation ? `Existing abbreviation: ${c.abbreviation}` : null,
    c.aliases?.length ? `Names users typed for it: ${c.aliases.join(', ')}` : null,
  ].filter(Boolean).join('\n');
}

const SYSTEM = `You name Danish grassroots football clubs the way coaches, parents and players say and write them day to day — the name you'd put on a lineup or a match card.

Rules of thumb (from the club data owner):
- Drop generic long-form prefixes when the rest is a proper name: "Boldklubben Hekla" → "Hekla", "Boldklubben Frem" → "Frem", "Boldklubben Fremad Valby" → "Fremad Valby".
- When the name is a town or area, keep the short club-type suffix, because the town alone is ambiguous: "Vanløse Idræts Forening" → "Vanløse IF", "Herfølge Boldklub" → "Herfølge BK", "Gørding Gymnastik- og Idrætsforening" → "Gørding GIF". Abbreviate the type words: Idrætsforening/Idræts Forening → IF, Boldklub/Boldklubben → BK or B, Gymnastikforening → GF, Fodboldklub → FK.
- Use an established abbreviation when that is clearly what everyone uses: "Frederiksberg Boldklub" → "FB", "Kjøbenhavns Boldklub" → "KB", "Boldklubben af 1893" → "B.93", "Akademisk Boldklub" → "AB".
- Keep names that are already short and everyday as they are ("Brabrand IF", "FC Helsingør", "Skovbakken").

Evidence:
- DBU team names are the strongest signal: that is how the club is registered in fixtures. Ignore names of cooperation/joint teams that share no words with the official name (e.g. "FC Midtfyn" for "Kværndrup BK") — those are a different team, not this club's name. DBU names sometimes drop the suffix ("Vanløse"); apply the town rule above.
- Website and email domains are supporting evidence (bkhekla.dk → "Hekla", b93.dk → "B.93").
- Don't invent abbreviations nobody uses. If there's no evidence beyond the official name, apply the rules conservatively.

Confidence: 0.9+ when DBU names or an existing nickname clearly support the result; 0.7–0.9 when the rules give an obvious answer; below 0.7 when unsure (several plausible forms, conflicting evidence).
basis: "dbu", "existing", "domain", "rules" or "unchanged" (official name is already everyday).`;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['commonName', 'confidence', 'basis', 'reason'],
  properties: {
    commonName: { type: 'string' },
    confidence: { type: 'number' },
    basis:      { type: 'string', enum: ['dbu', 'existing', 'domain', 'rules', 'unchanged'] },
    reason:     { type: 'string', description: 'One short sentence' },
  },
};

const params = c => ({
  model: MODEL,
  max_tokens: 1000,
  system: SYSTEM,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  messages: [{ role: 'user', content: signals(c) }],
});

function store(c, message) {
  if (message.stop_reason === 'refusal') throw new Error('refusal');
  const r = JSON.parse(message.content.find(b => b.type === 'text').text);
  out[c.dbuId] = { name: c.name, ...r, dbuNames: cleanTeamNames(teamNames[c.dbuId]).map(([n]) => n) };
  return r;
}

let work = clubs.filter(c => (!ids || ids.has(c.dbuId)) && (process.env.FORCE || !out[c.dbuId])).slice(0, LIMIT);
const byId = new Map(clubs.map(c => [String(c.dbuId), c]));

if (process.env.DIRECT) {
  for (const c of work) {
    const r = store(c, await client.messages.create(params(c)));
    console.log(`  ${c.name.padEnd(40)} → ${r.commonName.padEnd(18)} ${Math.round(r.confidence * 100)}% ${r.basis} — ${r.reason}`);
  }
  writeJson(OUT_PATH, out);
  process.exit(0);
}

let state = readJson(BATCH_STATE, null);
if (!state) {
  if (!work.length) { console.log('Nothing to do.'); process.exit(0); }
  const batch = await client.messages.batches.create({ requests: work.map(c => ({ custom_id: `club-${c.dbuId}`, params: params(c) })) });
  state = { id: batch.id, count: work.length };
  writeJson(BATCH_STATE, state);
  console.log(`Submitted batch ${batch.id} with ${work.length} clubs.`);
}
let batch;
while ((batch = await client.messages.batches.retrieve(state.id)).processing_status !== 'ended') {
  console.log(`  ${batch.request_counts.processing} processing, ${batch.request_counts.succeeded} done`);
  await sleep(30_000);
}
let ok = 0, failed = 0, inTok = 0, outTok = 0;
for await (const r of await client.messages.batches.results(state.id)) {
  const c = byId.get(r.custom_id.replace('club-', ''));
  try {
    if (r.result.type !== 'succeeded') throw new Error(r.result.type);
    store(c, r.result.message); ok++;
    inTok += r.result.message.usage.input_tokens; outTok += r.result.message.usage.output_tokens;
  } catch (e) { failed++; console.log(`  ✗ ${c?.name}: ${e.message}`); }
}
writeJson(OUT_PATH, out);
writeJson(BATCH_STATE, null);
console.log(`✓ ${ok} named, ${failed} failed → nameSuggestions.json  (≈ $${(inTok / 1e6 * 2 + outTok / 1e6 * 10).toFixed(2)} at batch prices)`);
