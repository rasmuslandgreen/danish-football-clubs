# Maintenance workflow

This covers the two main update scenarios: adding logos and scraping new club data.
Both result in a new release that consuming apps (Opstillingen) pull in by updating the version URL.

---

## Logo pipeline (automated)

The Figma logo file stays the master copy: one 500×500 frame per club, named by `dbuId`.
Scripts find and pick the crests. Claude places them in Figma through the Figma MCP,
you review them in Figma, and a script exports the approved frames.

| Step | Command | What it does |
|---|---|---|
| 1 | `npm run logos:queue` | `logoQueue.json`: clubs without a logo, clubs registered in Opstillingen first |
| 2 | `npm run logos:harvest` | `dbuLogoIndex.json`: official DBU crests, harvested from the match widgets on ~400 DBU klubcms sites (run once per season) |
| 3 | `npm run logos:collect` | Downloads every candidate image (DBU crest, website header/JSON-LD/icons, Wikidata, `logos-raw/`) to `assets/logo-candidates/{dbuId}/` |
| 4 | `npm run logos:judge` | Claude (vision) picks the real crest per club and rates its confidence → `logoJudgements.json`. For big runs use `BATCH=1` (half price, async) |
| 5 | `npm run logos:prep` | Trims and rasterizes the chosen image, and upscales small ones → `prepared.png` |
| 6 | Ask Claude: *"place the next 30 logos in Figma"* | Uses `node scripts/logos/placement.js next 30`, fills the frames via the Figma MCP, and marks them `needs-review` |
| 7 | Review in Figma | Adjust as you like. Tell Claude which ones are wrong, or *"approve all"* (runs `placement.js approve all`) |
| 8 | `npm run logos:export` | Exports approved frames from Figma (REST API) → `assets/logos/{dbuId}.png` at 500×500, compressed, then runs `npm run logos` |
| 9 | Release via the Klub Editor "Udgiv" button, or the steps below | Udgiv also runs `npm run warm-cdn` before bumping the apps |

**Where logos are served from:** `npm run logos` (and the Udgiv button) uploads every new or changed
logo to the public Supabase Storage bucket `club-logos`. Each logo goes up as `full/{dbuId}-{hash}.png` (500px)
and `thumb/{dbuId}-{hash}.webp` (160px, about 2–5 KB), and the URLs are written to `clubs.json` as
`logoUrl` / `logoThumbUrl`. The hash comes from the image itself, so a URL only changes when the logo does:
browsers and the CDN cache logos permanently, and releases don't re-send unchanged logos. Apps use
`logoThumbUrl` for avatars and fall back to the old `logo` path.

**jsDelivr limit:** jsDelivr refuses to serve a GitHub tag bigger than 50 MB, and it fails intermittently,
so random logos go missing. Keep large working folders such as `assets/logos-raw/` and
`assets/logo-candidates/` out of git; both are in `.gitignore`. `npm run warm-cdn` fails loudly
if the CDN won't serve something.

Steps 1–5 together: `npm run logos:pipeline`. All scripts accept `ONLY_IDS=1,2,3`. `logos:collect` and `logos:judge` also accept `LIMIT=N`.
Check progress with `npm run logos:status`.

`.env` needs `ANTHROPIC_API_KEY`, `FIGMA_TOKEN` (scope **File content: Read-only**), `FIGMA_FILE_KEY`,
and the Supabase keys. Clubs with no crest anywhere fall back to `clubBadgeUrl(name, { primaryColor, secondaryColor })`,
a monogram in the club's colors.

---

## Adding a new logo by hand

1. Find the club's `dbuId` — it's in `clubs.json` next to the club name.
2. Save the logo as a PNG (or JPG/SVG/WebP), named `{dbuId}.png` — e.g. `3700.png` for Brøndby IF.
3. Drop the file into `assets/logos/`.
4. Run the logo + build pipeline:
   ```
   npm run logos
   ```
   This runs `mergeLogos.js` (updates clubs.json with the logo path) then `buildIndex.js` (regenerates index.js).
5. Bump the version in `package.json` — patch release for logos (1.0.0 → 1.0.1).
6. Release:
   ```
   npm run release
   ```
   This pushes any commits, creates a git tag matching the version, and pushes the tag to GitHub.
7. Update Opstillingen — see [Updating Opstillingen](#updating-opstillingen) below.

---

## Scraping new club data

Run this once per season or when clubs are added/removed from DBU.

1. Run the scraper (takes 60–90 min, requires Playwright):
   ```
   npm run scrape
   ```
   This overwrites `clubs.json`. **Logos are preserved** — the scraper keeps the existing `logo` field.
2. Rebuild index.js:
   ```
   npm run build
   ```
3. Bump the version in `package.json` — minor release for data updates (1.0.0 → 1.1.0).
4. Release:
   ```
   npm run release
   ```
5. Update Opstillingen — see below.

---

## Updating Opstillingen

After releasing a new version, update the version tag in `opstillingen/src/utils/klub-combobox.js`.

Find `_CLUBS_CDN` at the top of the file and change the version:

```js
const _CLUBS_CDN = 'https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.0.0';
```

Change `@v1.0.0` to the new version tag (e.g. `@v1.1.0`), then commit and deploy.

**jsDelivr caches each version permanently** — changing the tag is how you get fresh data. Never rely on `@main`; always pin to a version tag.

---

## Who does what

Everything above can be done from the terminal or by asking Claude Code to do it.

- **Version bump** — edit `package.json` directly or ask Claude: *"bump to 1.0.1"*
- **`npm run logos` / `npm run build` / `npm run release`** — run in terminal or ask Claude
- **Version URL update in Opstillingen** — ask Claude: *"update the clubs URL to v1.0.1"*
- **Deploy Opstillingen** — ask Claude to push to staging; production requires explicit confirmation

---

## Version conventions

| Change type               | Bump  | Example       |
|---------------------------|-------|---------------|
| New or updated logo(s)    | Patch | 1.0.0 → 1.0.1 |
| Club data update (scrape) | Minor | 1.0.0 → 1.1.0 |
| New utility functions     | Minor | 1.0.0 → 1.1.0 |
| Breaking API changes      | Major | 1.0.0 → 2.0.0 |
