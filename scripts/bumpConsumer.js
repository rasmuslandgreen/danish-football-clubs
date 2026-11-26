/**
 * Points an app (opstillingen, findenklub, dashboard) at the current library
 * version, then commits and pushes ONLY that one file. Used by Udgiv in Klub Editor.
 *
 * The file has a current CDN line and a fallback line, e.g.
 *   const _CLUBS_CDN      = '…/danish-football-clubs@v1.2.38';
 *   const _CLUBS_CDN_PREV = '…/danish-football-clubs@v1.2.37';
 * The current line gets the new version, and the fallback gets the old current one.
 *
 * With --worktree the change is made in a temporary checkout of origin/main
 * instead of the local copy, so a local copy that is behind GitHub or has
 * unsaved work is never touched (and can't make the push fail).
 *
 * Usage: node scripts/bumpConsumer.js <repoPath> <file relative to repo> [--worktree]
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

const [repo, relFile, flag] = process.argv.slice(2);
const useWorktree = flag === '--worktree';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function bump(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const VER = /danish-football-clubs@v([\d.]+)/;
  const isPrev = l => /CDN_PREV\s*=/.test(l);
  const cur = lines.findIndex(l => /CDN\s*=/.test(l) && !isPrev(l) && VER.test(l));
  if (cur < 0) throw new Error(`no CDN line in ${file}`);
  const old = lines[cur].match(VER)[1];
  if (old === version) return false;
  lines[cur] = lines[cur].replace(VER, `danish-football-clubs@v${version}`);
  const prev = lines.findIndex(l => isPrev(l) && VER.test(l));
  if (prev >= 0) lines[prev] = lines[prev].replace(VER, `danish-football-clubs@v${old}`);
  writeFileSync(file, lines.join('\n'));
  console.log(`v${old} → v${version}`);
  return true;
}

function commitAndPush(cwd, pushRef) {
  git(cwd, 'add', '--', relFile);
  git(cwd, 'commit', '-q', '-m', `Bump danish-football-clubs to v${version}`, '--', relFile);
  git(cwd, 'push', '-q', 'origin', pushRef);
  console.log('pushed');
}

if (useWorktree) {
  git(repo, 'fetch', '-q', 'origin', 'main');
  const dir = mkdtempSync(join(tmpdir(), 'bump-'));
  try {
    git(repo, 'worktree', 'add', '-q', '--detach', dir, 'origin/main');
    if (bump(join(dir, relFile))) commitAndPush(dir, 'HEAD:main');
    else console.log(`already on v${version}`);
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', dir); } catch { rmSync(dir, { recursive: true, force: true }); }
  }
} else {
  if (bump(join(repo, relFile))) commitAndPush(repo, 'main');
  else console.log(`already on v${version}`);
}
