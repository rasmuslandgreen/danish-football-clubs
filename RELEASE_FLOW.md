# What happens when you click "Udgiv ny version"

This is the exact, current behaviour of the green **Udgiv ny version →** button in
the Klub Editor (`scripts/editor-server.js`, `/release` endpoint). Read this before
clicking if you're unsure what will go live and when.

**The short version: clicking Udgiv pushes new data straight to production on
opstillingen.dk (and findenklub.dk, if wired up) — immediately, with no staging
step and no confirmation prompt.** It is *not* just a library release.

---

## Step by step

1. **Gem ændringer i klub-data og logoer**
   Commits any uncommitted changes to `clubs.json` and `assets/logos/` in this repo.

2. **Byg genererede filer**
   Rebuilds `index.js` from `clubs.json`, and rebuilds `bydel.js`,
   `municipalities.js`/`municipalities.json`/`postal-municipalities.json`, and
   `teams.js` if their source files exist.

3. **Bump version i package.json**
   `npm version patch` — e.g. `1.2.11` → `1.2.12`.

4. **Commit og tag ny version**
   Commits the generated files and `package.json`, and creates a git tag
   `v1.2.12` matching the new version.

5. **Push danish-football-clubs til GitHub**
   Pushes `main` and the new tag to GitHub.
   ➜ **At this point nothing changes for users yet.** jsDelivr serves each
   version tag as a permanent, immutable URL
   (`https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.2.12/...`).
   A new tag is just a new URL that nobody is requesting yet — there's no cache
   to invalidate and no live site points at it. (jsDelivr can take a few minutes
   to first mirror a brand-new tag, so the URL may briefly 404 right after this step.)

   **What happens if a user hits opstillingen during that window:**
   `_loadDanishClubs()` in `opstillingen/src/utils/klub-combobox.js` tries
   `_CLUBS_CDN` (the new tag) first, and if that 404s, falls back to
   `_CLUBS_CDN_PREV` (the previous tag) and uses that for the rest of the
   session. This is why logos/data still load even if the brand-new tag isn't
   mirrored yet — the user just silently gets the *previous* version's data
   instead of the new one (e.g. new logos won't show up yet). A page reload a
   minute or two later, once jsDelivr has caught up, will pick up the new
   version normally. No error is shown to the user either way — it's just a
   console-only `Failed to load resource: 404` for the first (new-tag) request.

6. **Opdater CDN-version i opstillingen**
   Rewrites `_CLUBS_CDN` in `opstillingen/src/utils/klub-combobox.js` to point at
   the new version tag.

7. **Commit og push opstillingen**
   Commits that one-line change and runs `git push origin main` in the
   **opstillingen** repo.
   ➜ **Opstillingen's production deploy on Vercel is configured to deploy
   automatically on push to `main`.** This push triggers that deploy. Within a
   couple of minutes, opstillingen.dk is serving the new club data and logos to
   everyone — live users included, mid-session.

8. **Opdater CDN-version i findenklub** *(only if findenklub is wired up — see
   `FINDENKLUB_APP_PATH` in `scripts/editor-server.js`)*
   Same rewrite of the CDN version constant in findenklub's app file.

9. **Commit og push findenklub**
   Commits and pushes `main` in the **findenklub** repo.
   ➜ Same as step 7: if findenklub's production deploy is also set to
   auto-deploy on push to `main`, this goes live immediately too.

10. **Opdater CDN-version i dashboard** *(only if `DASHBOARD_APP_PATH` in
    `scripts/editor-server.js` exists)*
    Rewrites the `CDN` constant in
    `dashboard/src/components/club-logos.tsx` to point at the new version tag.

11. **Commit og push dashboard**
    Runs `git add -u && git commit ... && git push origin main` in the
    **dashboard** repo.
    ➜ Same as steps 7/9: a push to `main` triggers dashboard's production
    deploy. **Note:** `git add -u` stages *all* modified tracked files in the
    dashboard repo, not just `club-logos.tsx` — if you have other uncommitted
    work in dashboard, it'll get swept into this commit. Commit or stash dashboard
    changes first if that matters.

If any step fails, the pipeline stops and shows the error. Re-running Udgiv picks
up where it left off — git won't re-commit things that are already committed, and
`npm version patch` will just bump again from wherever `package.json` currently is.

---

## Kit contributions from users ("Synk bidrag til clubs.json")

Findenklub lets users submit a club's kit colours/pattern. Those submissions land
in a Supabase table (`club_kits`) — they do **not** touch this repo on their own.

The "Kit-bidrag fra brugere" panel in the editor shows the latest submissions
(one per club, most recent first) by reading directly from Supabase. This list is
just a live preview — looking at it doesn't change anything.

Clicking **"Synk bidrag til clubs.json →"** calls `/sync-kits`, which:

1. Pulls **all** rows from `club_kits`, grouped by club name.
2. **Skips any club with `kitLocked: true`** entirely (the "Lås kit — ignorer
   bruger-bidrag" checkbox in the club's kit editor). Use this once you've set a
   kit you consider correct and don't want a future user submission to overwrite it.
3. **If all submissions for a club agree** on `primary_color` (or there's only
   one submission), the most recent submission **overwrites** `primaryColor`,
   `secondaryColor`, and `kitStyle` in `clubs.json` directly — no comparison, no
   merge. User-submitted data is treated as authoritative and replaces whatever
   was there before (scraped colours, a previous manual edit, `null`, anything).
4. **If submissions disagree** (different users gave different primary colours
   for the same club), that club is **not** auto-applied. It's surfaced as a
   "conflict" in the UI so you can pick which one wins manually.
5. Writes the updated `clubs.json` to disk immediately.

**This step only edits the local `clubs.json` file.** It does not build, commit,
tag, or push anything — it's the same as if you'd hand-edited a club's colours in
the editor. To actually ship the new kit colours to opstillingen/findenklub, you
still need to run through the normal Udgiv flow (which rebuilds `index.js` from
the updated `clubs.json` as step 2, then bumps/commits/tags/pushes/deploys as
described above).

So for the two contributions you just synced (Hatting-Torsted, Vanløse Idræts
Forening): `clubs.json` on disk now reflects those users' kits as the truth.
Nothing is live yet — that happens when you click Udgiv.

**Setting `kitLocked: true`** is purely manual — it's never set by the sync
itself. Open the club in the editor, check **"Lås kit — ignorer bruger-bidrag"**,
and click "Gem kit". Use this once you've set a kit you consider correct, so a
future user submission can't silently overwrite it on the next sync. Unchecking
and saving again removes the lock.

---

## Why this matters for timing

- Steps 1–5 (the library release itself) have **zero effect on any live site**.
  You can do these any time of day with no risk.
- Steps 7 and 9 are the ones that actually change what users see — and they do
  it via a **direct push to production**, bypassing the normal
  "staging first, confirm before production" workflow that both
  opstillingen and findenklub otherwise follow.
- So: if you want to avoid surprising live users (e.g. a logo that looks wrong,
  or a data field that doesn't render the way you expect), do the full Udgiv
  flow during low-traffic hours — late evening / night — so you have time to
  spot and roll back a problem before people notice.

## If something looks wrong after releasing

jsDelivr keeps every old tag forever. To roll back, edit `_CLUBS_CDN` in
`opstillingen/src/utils/klub-combobox.js` (and findenklub's app file, if
relevant) back to the previous version tag, then push to `main` again — same
immediate-production-deploy caveat applies to the rollback too.

See [VERSIONING.md](VERSIONING.md) for the broader release/versioning model and
[WORKFLOW.md](WORKFLOW.md) for day-to-day maintenance tasks.
