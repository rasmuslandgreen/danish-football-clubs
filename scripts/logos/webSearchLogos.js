/**
 * For clubs still without a logo, lets Claude search the web (web_search +
 * web_fetch server tools) for the club's own crest: official site, Facebook
 * page, DBU page, local press. It returns direct image URLs, which are
 * downloaded as extra candidates (source "web") for the usual
 * judge → prep → Figma review flow.
 *
 * Skips schools and referee/tournament/union entries, and clubs already searched.
 * Records results and token/search usage in logoWebSearch.json.
 *
 * Usage: node scripts/logos/webSearchLogos.js
 * Env:   LIMIT=15  ONLY_IDS=1,2  FORCE=1  MODEL=claude-opus-5-5
 * Then:  ONLY_IDS=… node scripts/logos/judgeCandidates.js && node scripts/logos/prepLogo.js
 */

import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  ROOT, CANDIDATES_DIR, CANDIDATES_PATH, loadClubs, loadEnv, readJson, writeJson,
  onlyIds, downloadImage, hasLogo,
} from './lib.js';

const STATE_PATH  = join(ROOT, 'logoWebSearch.json');
const MODEL       = process.env.MODEL ?? 'claude-opus-5-5';
const LIMIT       = parseInt(process.env.LIMIT ?? '0', 10) || Infinity;
const FORCE       = !!process.env.FORCE;
const CONCURRENCY = 3;
const NOT_A_CLUB  = /efterskole|friskole|højskole|gymnasi|skole|dommer|veteran|turnering|forbund|union|kreds/i;

const env = loadEnv();
if (!env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing in .env'); process.exit(1); }
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

const state    = readJson(STATE_PATH, {});
const manifest = readJson(CANDIDATES_PATH, {});
const ids      = onlyIds();

let targets = loadClubs().filter(c =>
  !hasLogo(c.dbuId) && (ids ? ids.has(c.dbuId) : !NOT_A_CLUB.test(c.name)) && (FORCE || !state[c.dbuId]));
targets = targets.slice(0, LIMIT);

const SYSTEM = `You find the official crest (club logo) of small Danish grassroots football clubs.
Search the web for the given club and locate its crest image. Good sources: the club's own website, its Facebook page (profile picture), its DBU page (dbu.dk / file.dbu.dk/images/club/…), its page on a municipality or sports-association site, or local news articles showing the crest.
Make sure it is THIS club (same name and town). Many villages have similarly named clubs. A merged or umbrella club's crest only counts if this club now plays under that name; say so in notes.
Return direct URLs to image files (png/jpg/svg/webp, or a Facebook/CDN image URL), not HTML pages. Prefer the largest, cleanest version. Max 3 URLs, best first.
If you cannot find the crest with reasonable confidence, return found=false. Never guess.
End your reply with ONLY a JSON object in a \`\`\`json code block, with this shape:
{"found": boolean, "imageUrls": string[], "website": string|null, "facebook": string|null, "notes": string}`;

function prompt(c) {
  const domain = c.email?.split('@')[1];
  return [
    `Club: ${c.name}`,
    `Town: ${c.city ?? '?'} (${c.postal ?? '?'}), municipality ${c.municipality ?? '?'}, region ${c.region ?? '?'}`,
    `DBU club id: ${c.dbuId}`,
    c.website ? `Known website: ${c.website}` : null,
    domain && !/gmail|hotmail|yahoo|live|outlook|mail\.dk|jubii|icloud|me\.com|privat/i.test(domain) ? `Club email domain (often its website): ${domain}` : null,
    `Find this club's crest.`,
  ].filter(Boolean).join('\n');
}

function parseJson(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*"found"[\s\S]*\})/);
  if (!m) throw new Error('no JSON in reply');
  return JSON.parse(m[1]);
}

async function search(c) {
  const messages = [{ role: 'user', content: prompt(c) }];
  const usage = { input: 0, output: 0, searches: 0, fetches: 0 };
  let message;
  for (let turn = 0; turn < 4; turn++) {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      output_config: { effort: 'low' },
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'DK' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 },
      ],
      messages,
    });
    usage.input    += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
    usage.output   += message.usage.output_tokens;
    usage.searches += message.usage.server_tool_use?.web_search_requests ?? 0;
    usage.fetches  += message.usage.server_tool_use?.web_fetch_requests ?? 0;
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content }); // resume server-side loop
  }
  if (message.stop_reason === 'refusal') throw new Error('refusal');
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return { result: parseJson(text), usage };
}

async function addCandidates(c, urls) {
  const entry = manifest[c.dbuId] ?? { name: c.name, website: c.website ?? null, candidates: [] };
  entry.candidates = entry.candidates.filter(k => k.source !== 'web');
  const dir = join(CANDIDATES_DIR, String(c.dbuId));
  let added = 0;
  for (const url of urls.slice(0, 3)) {
    try {
      const n = entry.candidates.length + 1;
      const { path, bytes } = await downloadImage(url, dir, `c${n}-web`);
      entry.candidates.push({ id: `c${n}`, source: 'web', url, file: path.replace(ROOT + '/', ''), bytes });
      added++;
    } catch (e) { (entry.errors ??= []).push(`web: ${e.message}`); }
  }
  manifest[c.dbuId] = entry;
  return added;
}

console.log(`Web-searching ${targets.length} clubs with ${MODEL}…`);
const total = { input: 0, output: 0, searches: 0, fetches: 0 };
let found = 0, withImages = 0, failed = 0;
const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const c = queue.shift();
    try {
      const { result, usage } = await search(c);
      for (const k in total) total[k] += usage[k];
      const added = result.found ? await addCandidates(c, result.imageUrls ?? []) : 0;
      if (result.found) found++;
      if (added) withImages++;
      state[c.dbuId] = { name: c.name, ...result, downloaded: added, usage, model: MODEL, searchedAt: new Date().toISOString() };
      console.log(`  ${added ? '✓' : '–'} [${c.dbuId}] ${c.name}: ${result.found ? `${added}/${(result.imageUrls ?? []).length} image(s)` : 'not found'} — ${result.notes?.slice(0, 110) ?? ''}  (${usage.searches}s/${usage.fetches}f)`);
    } catch (e) {
      failed++;
      console.log(`  ✗ [${c.dbuId}] ${c.name}: ${e.message}`);
    }
    writeJson(STATE_PATH, state);
    writeJson(CANDIDATES_PATH, manifest);
  }
}));

// Rough cost: model token prices per 1M tokens + $10 per 1,000 searches (web_fetch has no extra fee)
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const [pi, po] = PRICES[MODEL] ?? [4, 20];
const cost = total.input / 1e6 * pi + total.output / 1e6 * po + total.searches / 1000 * 10;
console.log(`\n✓ ${targets.length} searched: ${found} found, ${withImages} with downloadable images, ${failed} failed`);
console.log(`  usage: ${total.input} input / ${total.output} output tokens, ${total.searches} searches, ${total.fetches} fetches`);
console.log(`  ≈ $${cost.toFixed(2)} total, $${(cost / Math.max(1, targets.length)).toFixed(3)} per club`);
