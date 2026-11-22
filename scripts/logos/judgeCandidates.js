/**
 * Asks Claude (vision) to pick the real club crest among each club's candidates
 * in logoCandidates.json. Results are written to logoJudgements.json.
 *
 * A club is skipped when it was already judged against the same candidate set.
 *
 * Usage:
 *   node scripts/logos/judgeCandidates.js            # direct calls (good for < ~50 clubs)
 *   BATCH=1 node scripts/logos/judgeCandidates.js    # Message Batches API, 50% cheaper, async
 * Env:
 *   ONLY_IDS=1,2,3   FORCE=1   LIMIT=50
 * Needs ANTHROPIC_API_KEY in .env.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import {
  ROOT, CANDIDATES_PATH, JUDGEMENTS_PATH,
  loadClubs, loadEnv, readJson, writeJson, onlyIds, sleep,
} from './lib.js';

const MODEL       = 'claude-opus-5-5';
const THUMB       = 320;
const CONCURRENCY = 4;
const BATCH_STATE = join(ROOT, 'logoJudgeBatch.json');

const env = loadEnv();
if (!env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing in .env'); process.exit(1); }
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const clubs      = new Map(loadClubs().map(c => [c.dbuId, c]));
const manifest   = readJson(CANDIDATES_PATH, {});
const judgements = readJson(JUDGEMENTS_PATH, {});
const ids        = onlyIds();
const FORCE      = !!process.env.FORCE;
const LIMIT      = parseInt(process.env.LIMIT ?? '0', 10) || Infinity;

const signature = entry => entry.candidates.map(c => `${c.id}:${c.bytes ?? ''}`).join('|');

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM = `You curate a library of Danish grassroots football club crests (klubmærker) for a team-lineup app.
For one club you get its name, city and website, plus candidate images scraped from its website, DBU (the Danish FA), and Wikidata.
Pick the image that is this club's own crest or primary logo.

Reject candidates that are: sponsor logos, DBU/DIF/kommune/union logos, other clubs' crests, app-store badges, social icons, photos, generic CMS favicons, banners where the crest is only a tiny part, or a different sports club with a similar name.
A source labelled "dbu" comes from DBU's own club record and is very likely right if it looks like a crest.
Prefer: the official crest over a wordmark-only logo, larger/sharper files, vector (svg) over raster when equal, transparent or plain background over busy ones.
If no candidate is clearly this club's logo, set bestCandidate to null.

Also describe the chosen logo:
- shape: "round" (circular crest), "shield", "square", "wordmark" (mostly text, wide), or "other".
- background: "white" if the logo reads well centered on a white circle; "fill" if the crest is designed to sit on a solid color (e.g. a white/light crest, or a crest whose outer shape is a filled color disc) — then give fillColor as the hex to fill the circle with.
- primaryColor / secondaryColor: the club's two main colors as seen in the crest (hex), or null.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bestCandidate', 'isClubCrest', 'confidence', 'shape', 'background', 'fillColor', 'primaryColor', 'secondaryColor', 'reason'],
  properties: {
    bestCandidate:  { type: ['string', 'null'], description: 'Candidate id, e.g. "c2", or null' },
    isClubCrest:    { type: 'boolean' },
    confidence:     { type: 'number', description: '0–1' },
    shape:          { type: 'string', enum: ['round', 'shield', 'square', 'wordmark', 'other'] },
    background:     { type: 'string', enum: ['white', 'fill'] },
    fillColor:      { type: ['string', 'null'] },
    primaryColor:   { type: ['string', 'null'] },
    secondaryColor: { type: ['string', 'null'] },
    reason:         { type: 'string', description: 'One short sentence' },
  },
};

async function thumbnail(file) {
  const img = sharp(readFileSync(join(ROOT, file)), { density: 200, animated: false });
  const meta = await img.metadata();
  const png = await img
    .resize(THUMB, THUMB, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#f2f2f2' }) // light grey so white crests stay visible
    .png()
    .toBuffer();
  return { data: png.toString('base64'), width: meta.width, height: meta.height, format: meta.format };
}

async function buildParams(dbuId, entry) {
  const club = clubs.get(+dbuId) ?? {};
  const content = [{
    type: 'text',
    text: `Club: ${entry.name}\nCity: ${club.city ?? '?'}\nWebsite: ${entry.finalUrl ?? entry.website ?? 'none'}\n\nCandidates follow.`,
  }];
  for (const c of entry.candidates) {
    try {
      const t = await thumbnail(c.file);
      content.push({ type: 'text', text: `Candidate ${c.id} — source: ${c.source}, original ${t.width}×${t.height} ${t.format}${c.url && c.url !== 'inline' ? `, url: ${c.url}` : ''}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: t.data } });
    } catch (e) {
      content.push({ type: 'text', text: `Candidate ${c.id} — could not be decoded (${e.message})` });
    }
  }
  return {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  };
}

function parseResult(message) {
  if (message.stop_reason === 'refusal') throw new Error('refusal');
  const text = message.content.find(b => b.type === 'text')?.text;
  if (!text) throw new Error(`no text (stop_reason ${message.stop_reason})`);
  return JSON.parse(text);
}

function store(dbuId, entry, result) {
  const cand = entry.candidates.find(c => c.id === result.bestCandidate) ?? null;
  judgements[dbuId] = {
    name: entry.name,
    ...result,
    file: cand?.file ?? null,
    source: cand?.source ?? null,
    signature: signature(entry),
    model: MODEL,
    judgedAt: new Date().toISOString(),
  };
}

// ── Select work ─────────────────────────────────────────────────────────────

let work = Object.entries(manifest)
  .filter(([id, e]) => e.candidates.length)
  .filter(([id]) => !ids || ids.has(+id))
  .filter(([id, e]) => FORCE || judgements[id]?.signature !== signature(e))
  .slice(0, LIMIT);

// ── Batch mode ──────────────────────────────────────────────────────────────

if (process.env.BATCH) {
  let state = readJson(BATCH_STATE, null);
  if (!state) {
    if (!work.length) { console.log('Nothing to judge.'); process.exit(0); }
    const requests = [];
    for (const [id, e] of work) requests.push({ custom_id: `club-${id}`, params: await buildParams(id, e) });
    const batch = await client.messages.batches.create({ requests });
    state = { id: batch.id, createdAt: new Date().toISOString(), count: requests.length };
    writeJson(BATCH_STATE, state);
    console.log(`Submitted batch ${batch.id} with ${requests.length} clubs. Polling…`);
  } else {
    console.log(`Resuming batch ${state.id}…`);
  }
  let batch;
  while ((batch = await client.messages.batches.retrieve(state.id)).processing_status !== 'ended') {
    console.log(`  ${batch.processing_status}: ${batch.request_counts.processing} processing, ${batch.request_counts.succeeded} done`);
    await sleep(30_000);
  }
  let ok = 0, failed = 0;
  for await (const r of await client.messages.batches.results(state.id)) {
    const id = r.custom_id.replace('club-', '');
    try {
      if (r.result.type !== 'succeeded') throw new Error(r.result.type);
      store(id, manifest[id], parseResult(r.result.message));
      ok++;
    } catch (e) { console.log(`  ✗ ${id}: ${e.message}`); failed++; }
  }
  writeJson(JUDGEMENTS_PATH, judgements);
  writeJson(BATCH_STATE, null);
  console.log(`✓ ${ok} judged, ${failed} failed → logoJudgements.json`);
  process.exit(0);
}

// ── Direct mode ─────────────────────────────────────────────────────────────

console.log(`Judging ${work.length} clubs with ${MODEL}…`);
let ok = 0, failed = 0;
const queue = [...work];
async function worker() {
  while (queue.length) {
    const [id, entry] = queue.shift();
    try {
      const params = await buildParams(id, entry);
      // Server-side fallback: if a safety classifier declines, the API retries on a fallback model.
      const message = await client.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
      const result = parseResult(message);
      store(id, entry, result);
      ok++;
      console.log(`  ${result.bestCandidate ? '✓' : '–'} [${id}] ${entry.name}: ${result.bestCandidate ?? 'none'} ` +
        `(${result.source ?? judgements[id].source ?? ''}, ${Math.round(result.confidence * 100)}%, ${result.shape}/${result.background}) — ${result.reason}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ [${id}] ${entry.name}: ${e.message}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeJson(JUDGEMENTS_PATH, judgements);
console.log(`\n✓ ${ok} judged, ${failed} failed → logoJudgements.json`);
