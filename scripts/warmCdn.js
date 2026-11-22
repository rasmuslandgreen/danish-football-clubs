/**
 * Warms jsDelivr for a released version: requests clubs.json, index.js and
 * every logo at the new tag so the CDN has them cached before consuming apps
 * switch to that version.
 *
 * Without this, the first visitors after a release hit cold URLs. jsDelivr
 * then fetches each file from GitHub, and when a page requests dozens at once
 * some fail and the app shows the fallback badge instead of the logo.
 *
 * Usage: node scripts/warmCdn.js [version]   (defaults to package.json version)
 * Exits non-zero if any file still fails after retries.
 */

import { readFileSync } from 'fs';

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const BASE = `https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v${version}`;
const CONCURRENCY = 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const clubs = JSON.parse(readFileSync('clubs.json', 'utf8'));
const paths = ['clubs.json', 'index.js', ...clubs.filter(c => c.logo).map(c => c.logo)];

async function warm(path) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(20000) });
      await res.arrayBuffer();
      if (res.ok) return true;
    } catch {}
    await sleep(1000 * attempt);
  }
  return false;
}

console.log(`Warming ${paths.length} files at v${version}…`);
const failed = [];
let done = 0;
const queue = [...paths];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const p = queue.shift();
    if (!(await warm(p))) failed.push(p);
    if (++done % 200 === 0) console.log(`  ${done}/${paths.length}`);
  }
}));

if (failed.length) {
  console.error(`✗ ${failed.length} file(s) not served:\n  ${failed.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ All ${paths.length} files cached on jsDelivr`);
