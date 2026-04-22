# Maintenance workflow

This covers the two main update scenarios: adding logos and scraping new club data.
Both result in a new release that consuming apps (Opstillingen) pull in by updating the version URL.

---

## Adding a new logo

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

After releasing a new version, update the version tag in `opstillingen/src/features/cloud.js`.

Find `_CLUBS_URL` near the top of the Klub combobox section and change the version:

```js
const _CLUBS_URL = 'https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.0.0/clubs.json';
```

Change `@v1.0.0` to the new version tag (e.g. `@v1.0.1`), then commit and deploy.

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
