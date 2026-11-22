/**
 * Publishes logos to GitHub Pages (the gh-pages branch of this repo) under
 * content-hashed names, and writes their URLs into clubs.json.
 *
 *   full/{dbuId}-{hash}.png    500×500 PNG (as in assets/logos/)
 *   thumb/{dbuId}-{hash}.webp  160×160 WebP for avatars (~2–5 KB)
 *
 * Served from https://rasmuslandgreen.github.io/danish-football-clubs/…
 * GitHub Pages is plain static hosting behind a CDN: no database behind
 * it, so logo traffic can never compete with the apps' Supabase users.
 *
 * A logo's URL only changes when the image itself changes, so a library
 * release never makes browsers fetch unchanged logos again. The gh-pages
 * branch is not part of the version tags, so it doesn't count towards
 * jsDelivr's 50 MB limit either.
 *
 * clubs.json gets logoUrl + logoThumbUrl next to the existing `logo` path,
 * which keeps working for apps that haven't switched.
 *
 * The gh-pages branch is checked out as a git worktree in .gh-pages/
 * (gitignored); the script creates it if missing, commits new files and
 * pushes. Old files are kept so previously released URLs keep working.
 *
 * Usage: node scripts/logos/uploadLogos.js      Env: NO_PUSH=1 (commit only)
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import sharp from 'sharp';
import { ROOT, LOGOS_DIR, CLUBS_PATH, readJson, writeJson } from './lib.js';

const PAGES_BASE = 'https://rasmuslandgreen.github.io/danish-football-clubs';
const WORKTREE   = join(ROOT, '.gh-pages');
const THUMB      = 160;

const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// ── Make sure the gh-pages worktree exists and is up to date ────────────────
if (!existsSync(join(WORKTREE, '.git'))) {
  git(['fetch', 'origin', 'gh-pages']);
  try { git(['worktree', 'prune']); } catch {}
  git(['worktree', 'add', WORKTREE, 'gh-pages']);
}
git(['pull', '--ff-only', 'origin', 'gh-pages'], WORKTREE);
mkdirSync(join(WORKTREE, 'full'), { recursive: true });
mkdirSync(join(WORKTREE, 'thumb'), { recursive: true });

// ── Write hashed files ──────────────────────────────────────────────────────
const clubs = readJson(CLUBS_PATH, []);
const byId  = new Map(clubs.map(c => [String(c.dbuId), c]));
const files = readdirSync(LOGOS_DIR).filter(f => /^\d+\.(png|jpe?g|webp|svg)$/i.test(f));

let added = 0, unchanged = 0;
for (const file of files) {
  const id = file.slice(0, -extname(file).length);
  const club = byId.get(id);
  if (!club) continue;

  const buf  = readFileSync(join(LOGOS_DIR, file));
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10);
  const fullPath  = `full/${id}-${hash}.png`;
  const thumbPath = `thumb/${id}-${hash}.webp`;
  let isNew = false;

  if (!existsSync(join(WORKTREE, fullPath))) {
    const png = extname(file).toLowerCase() === '.png' ? buf : await sharp(buf).png().toBuffer();
    writeFileSync(join(WORKTREE, fullPath), png);
    isNew = true;
  }
  if (!existsSync(join(WORKTREE, thumbPath))) {
    const webp = await sharp(buf).resize(THUMB, THUMB, { fit: 'contain', background: '#ffffff' })
      .flatten({ background: '#ffffff' }).webp({ quality: 82 }).toBuffer();
    writeFileSync(join(WORKTREE, thumbPath), webp);
    isNew = true;
  }
  isNew ? added++ : unchanged++;

  club.logoUrl      = `${PAGES_BASE}/${fullPath}`;
  club.logoThumbUrl = `${PAGES_BASE}/${thumbPath}`;
}

// Clubs whose logo file was removed lose their URLs too
let cleared = 0;
for (const c of clubs) {
  if (!c.logo && (c.logoUrl || c.logoThumbUrl)) { delete c.logoUrl; delete c.logoThumbUrl; cleared++; }
}
writeJson(CLUBS_PATH, clubs);

// ── Commit + push gh-pages ──────────────────────────────────────────────────
git(['add', 'full', 'thumb'], WORKTREE);
const staged = git(['diff', '--cached', '--name-only'], WORKTREE);
if (staged) {
  git(['commit', '-q', '-m', `Publish ${added} logo(s)`], WORKTREE);
  if (!process.env.NO_PUSH) git(['push', '-q', 'origin', 'gh-pages'], WORKTREE);
}

console.log(`✓ ${added} logo(s) published, ${unchanged} unchanged${cleared ? `, ${cleared} cleared` : ''}` +
  `${staged && !process.env.NO_PUSH ? ' → pushed to gh-pages' : ''} → clubs.json logoUrl/logoThumbUrl`);
if (staged && !process.env.NO_PUSH) console.log('  GitHub Pages usually goes live within 1–2 minutes.');
