/**
 * Publishes logos to Supabase Storage (public bucket "club-logos") under
 * content-hashed names, and writes their URLs into clubs.json.
 *
 *   full/{dbuId}-{hash}.png    500×500 PNG (as in assets/logos/)
 *   thumb/{dbuId}-{hash}.webp  160×160 WebP for avatars (~2–5 KB)
 *
 * A logo's URL only changes when the image itself changes, so files are
 * cached forever (immutable) and a library release never forces browsers
 * or the CDN to fetch unchanged logos again. Logos no longer travel with
 * the jsDelivr tag either, so there's no package size limit to hit.
 *
 * clubs.json gets logoUrl + logoThumbUrl next to the existing `logo` path,
 * which keeps working for apps that haven't switched yet.
 *
 * Usage: node scripts/logos/uploadLogos.js     (only uploads what's new)
 * Needs SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { LOGOS_DIR, CLUBS_PATH, loadEnv, readJson, writeJson } from './lib.js';

const BUCKET = 'club-logos';
const THUMB  = 160;
const CONCURRENCY = 3;

const env = loadEnv();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing in .env'); process.exit(1); }
const auth = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
const publicUrl = path => `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

async function ensureBucket() {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, { headers: auth });
  if (res.ok) return;
  const create = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, allowed_mime_types: ['image/png', 'image/webp'], file_size_limit: 2_000_000 }),
  });
  if (!create.ok) throw new Error(`create bucket: ${create.status} ${await create.text()}`);
  console.log(`Created public bucket "${BUCKET}"`);
}

/** Lists every object path under a prefix (paginated). */
async function listExisting(prefix) {
  const out = new Set();
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    });
    if (!res.ok) throw new Error(`list ${prefix}: ${res.status} ${await res.text()}`);
    const items = await res.json();
    items.forEach(i => out.add(`${prefix}/${i.name}`));
    if (items.length < 1000) return out;
  }
}

async function upload(path, body, contentType) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable', 'x-upsert': 'true' },
      body,
    });
    if (res.ok) return;
    if (attempt === 6) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
    await new Promise(r => setTimeout(r, 1500 * 2 ** attempt));
  }
}

await ensureBucket();
const existing = new Set([...await listExisting('full'), ...await listExisting('thumb')]);

const clubs = readJson(CLUBS_PATH, []);
const byId  = new Map(clubs.map(c => [String(c.dbuId), c]));
const files = readdirSync(LOGOS_DIR).filter(f => /^\d+\.(png|jpe?g|webp|svg)$/i.test(f));

let uploaded = 0, unchanged = 0;
const queue = [...files];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length) {
    const file = queue.shift();
    const id = file.slice(0, -extname(file).length);
    const club = byId.get(id);
    if (!club) continue;

    const buf  = readFileSync(join(LOGOS_DIR, file));
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10);
    const fullPath  = `full/${id}-${hash}.png`;
    const thumbPath = `thumb/${id}-${hash}.webp`;

    if (!existing.has(fullPath)) {
      const png = extname(file).toLowerCase() === '.png' ? buf : await sharp(buf).png().toBuffer();
      await upload(fullPath, png, 'image/png');
    }
    if (!existing.has(thumbPath)) {
      const webp = await sharp(buf).resize(THUMB, THUMB, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).webp({ quality: 82 }).toBuffer();
      await upload(thumbPath, webp, 'image/webp');
    }
    if (existing.has(fullPath) && existing.has(thumbPath)) unchanged++; else uploaded++;

    club.logoUrl      = publicUrl(fullPath);
    club.logoThumbUrl = publicUrl(thumbPath);
  }
}));

// Clubs whose logo file was removed lose their URLs too
let cleared = 0;
for (const c of clubs) {
  if (!c.logo && (c.logoUrl || c.logoThumbUrl)) { delete c.logoUrl; delete c.logoThumbUrl; cleared++; }
}

writeJson(CLUBS_PATH, clubs);
console.log(`✓ ${uploaded} logo(s) uploaded, ${unchanged} unchanged${cleared ? `, ${cleared} cleared` : ''} → clubs.json logoUrl/logoThumbUrl`);
