/**
 * Fills in MISSING club colours from the club's crest. Never overwrites an
 * existing colour (e.g. one a user contributed) and skips kitLocked clubs.
 *
 * Colour source per club:
 *   1. the crest reading Claude made while judging logo candidates (logoJudgements.json)
 *   2. otherwise Claude reads the published crest (assets/logos/{dbuId}.png), cached in crestColors.json
 *
 * Usage: node scripts/logos/fillColorsFromCrests.js          (dry run: prints what would change)
 *        APPLY=1 node scripts/logos/fillColorsFromCrests.js  (writes clubs.json)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { ROOT, CLUBS_PATH, LOGOS_DIR, JUDGEMENTS_PATH, loadEnv, readJson, writeJson, findFile } from './lib.js';

const CACHE_PATH = join(ROOT, 'crestColors.json');
const MODEL = 'claude-opus-5-5';
const APPLY = !!process.env.APPLY;

const isHex = h => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
const norm  = h => isHex(h) ? h.toUpperCase() : null;

const raw        = readFileSync(CLUBS_PATH, 'utf8');
const clubs      = JSON.parse(raw);
const judgements = readJson(JUDGEMENTS_PATH, {});
const cache      = readJson(CACHE_PATH, {});

const needs = clubs.filter(c =>
  c.logo && c.logoKind !== 'monogram' && !c.kitLocked && (!isHex(c.primaryColor) || !isHex(c.secondaryColor)));

function fromJudgement(c) {
  const j = judgements[c.dbuId];
  if (!j?.isClubCrest || !isHex(j.primaryColor)) return null;
  return { primary: norm(j.primaryColor), secondary: norm(j.secondaryColor), source: 'judgement' };
}

// ── Claude reads colours from crests that have no judgement ────────────────
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['primaryColor', 'secondaryColor'],
  properties: { primaryColor: { type: ['string', 'null'] }, secondaryColor: { type: ['string', 'null'] } },
};
async function readCrest(c) {
  if (cache[c.dbuId]) return { ...cache[c.dbuId], source: 'crest-read' };
  const file = findFile(LOGOS_DIR, c.dbuId);
  const png = await sharp(file).resize(320, 320, { fit: 'inside' }).png().toBuffer();
  const env = loadEnv();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 1000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
      { type: 'text', text: `This is the crest of the Danish football club "${c.name}". Give the club's two main colours as hex, as they appear in the crest (main colour first). Ignore the white or transparent background unless white is clearly one of the club colours. Use null for secondaryColor if there is only one colour.` },
    ] }],
  });
  const r = JSON.parse(msg.content.find(b => b.type === 'text').text);
  cache[c.dbuId] = { primary: norm(r.primaryColor), secondary: norm(r.secondaryColor) };
  writeJson(CACHE_PATH, cache);
  return { ...cache[c.dbuId], source: 'crest-read' };
}

let filledP = 0, filledS = 0, replacedS = 0, noSource = 0;
const changes = [];
for (const c of needs) {
  const col = fromJudgement(c) ?? await readCrest(c).catch(e => { console.log(`  ✗ ${c.name}: ${e.message}`); return null; });
  if (!col?.primary) { noSource++; continue; }
  const before = `${c.primaryColor ?? '—'}/${c.secondaryColor ?? '—'}`;
  if (!isHex(c.primaryColor)) {
    // No main colour means nobody has set this club's colours (user contributions
    // always set both), so a lone secondary is just scraped default data: take
    // the crest's pair instead of mixing the two.
    c.primaryColor = col.primary; filledP++;
    if (col.secondary) { if (isHex(c.secondaryColor)) replacedS++; c.secondaryColor = col.secondary; filledS++; }
  } else if (!isHex(c.secondaryColor) && col.secondary && col.secondary !== c.primaryColor.toUpperCase()) {
    c.secondaryColor = col.secondary; filledS++;
  } else continue;
  changes.push(`  ${c.name.padEnd(38)} ${before.padEnd(17)} → ${c.primaryColor}/${c.secondaryColor ?? '—'}  (${col.source})`);
}

console.log(changes.join('\n'));
console.log(`\n${needs.length} crest clubs missing a colour: ${filledP} primary + ${filledS} secondary filled (${replacedS} lone scraped secondaries replaced by the crest pair), ${noSource} without a usable reading`);
if (APPLY) {
  writeFileSync(CLUBS_PATH, JSON.stringify(clubs, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
  console.log('✓ clubs.json updated');
} else {
  console.log('(dry run — run with APPLY=1 to write clubs.json)');
}
