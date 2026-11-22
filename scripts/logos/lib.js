/**
 * Shared helpers for the logo pipeline (scripts/logos/*).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';

export const ROOT           = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const CLUBS_PATH     = join(ROOT, 'clubs.json');
export const LOGOS_DIR      = join(ROOT, 'assets/logos');
export const RAW_DIR        = join(ROOT, 'assets/logos-raw');
export const CANDIDATES_DIR = join(ROOT, 'assets/logo-candidates');
export const QUEUE_PATH     = join(ROOT, 'logoQueue.json');
export const CANDIDATES_PATH = join(ROOT, 'logoCandidates.json');
export const JUDGEMENTS_PATH = join(ROOT, 'logoJudgements.json');

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.bmp', '.ico'];
export const USER_AGENT = 'danish-football-clubs/1.0 (logo pipeline)';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

export function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function loadClubs() {
  return readJson(CLUBS_PATH, []);
}

/** Reads KEY=value pairs from .env (never committed). */
export function loadEnv() {
  const env = {};
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

export function findFile(dir, base) {
  for (const ext of IMAGE_EXTS) {
    const p = join(dir, `${base}${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

export const hasLogo = dbuId => !!findFile(LOGOS_DIR, dbuId);

/** Parses ONLY_IDS=1,2,3 from env into a Set of numbers (or null). */
export function onlyIds() {
  const v = process.env.ONLY_IDS;
  return v ? new Set(v.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))) : null;
}

export function normaliseName(str) {
  return str
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/[.\-\/,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), finalUrl: res.url };
}

function extFromContentType(ct) {
  if (ct.includes('svg'))  return '.svg';
  if (ct.includes('png'))  return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif'))  return '.gif';
  if (ct.includes('icon')) return '.ico';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  return null;
}

/**
 * Downloads an image (or data: URI) to `dir/name{ext}`. Returns { path, bytes } or throws.
 */
export async function downloadImage(url, dir, name) {
  mkdirSync(dir, { recursive: true });
  let buf, ext;

  if (url.startsWith('data:')) {
    const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!m) throw new Error('bad data URI');
    buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    ext = extFromContentType(m[1]) ?? '.png';
  } else {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct && !ct.startsWith('image/') && !ct.includes('octet-stream')) throw new Error(`not an image (${ct})`);
    buf = Buffer.from(await res.arrayBuffer());
    ext = extFromContentType(ct) ?? extname(new URL(url).pathname).toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) ext = '.png';
  }

  if (buf.length < 300) throw new Error(`too small (${buf.length} B)`);
  const path = join(dir, `${name}${ext === '.jpeg' ? '.jpg' : ext}`);
  writeFileSync(path, buf);
  return { path, bytes: buf.length };
}

/** Same rule as editor-server's /custom-clubs: counts user_data rows per club_name. */
export async function fetchRegisteredClubCounts() {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/user_data?select=club_name`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
  const counts = new Map();
  for (const row of await res.json()) {
    if (row.club_name) counts.set(row.club_name, (counts.get(row.club_name) ?? 0) + 1);
  }
  return counts;
}
