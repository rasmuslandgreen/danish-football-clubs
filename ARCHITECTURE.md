# Architecture — danish-football-clubs

A static dataset and utility library of Danish football clubs. Provides club data, DBU age-group utilities, and badge rendering for football apps.

---

## Purpose

- Canonical list of 696 Danish football clubs scraped from dbu.dk
- Consistent club naming across apps (no free-text variations)
- SVG badge fallback when a logo is unavailable
- DBU age-group (U-level) and match format lookup by birth year

---

## File structure

```
danish-football-clubs/
  index.js              # ESM entry — club data + all exports (generated, do not edit)
  global.js             # window.DanishFootballClubs shim for non-module contexts
  clubs.json            # Source of truth for club data — edit this, then run build
  demo.html             # Browser demo (club picker + DBU lookup)
  package.json
  ARCHITECTURE.md       # This file
  SCRAPING.md           # How to re-scrape and update the dataset

  assets/
    logos/              # Club logo images, named by dbuId (e.g. 1567.png)

  scripts/
    scrapeClubs.js      # Scrapes dbu.dk → writes clubs.json
    buildIndex.js       # Reads clubs.json → writes index.js
    mergeLogos.js       # Scans assets/logos/ → updates logo fields in clubs.json
    buildFigmaPlugin.js # Generates figma-plugin/code.js from clubs.json

  figma-plugin/
    manifest.json       # Figma plugin metadata
    code.js             # Generated plugin — creates one artboard per club in Figma

  .claude/
    launch.json         # Preview server config (python3 -m http.server 3456)
```

---

## Data model

`clubs.json` is the source of truth. `index.js` is generated from it — never edit `index.js` directly.

Each club object:

```json
{
  "name":           "Brøndby IF",
  "city":           "Brøndby",
  "postal":         "2605",
  "region":         "Hovedstaden",
  "dbuId":          3700,
  "primaryColor":   null,
  "secondaryColor": null,
  "kitStyle":       null,
  "logo":           null
}
```

| Field | Description |
|---|---|
| `name` | Canonical DBU display name |
| `city` | City name |
| `postal` | Danish 4-digit postal code |
| `region` | One of: `Hovedstaden`, `Sjælland`, `Fyn`, `Jylland`, `Bornholm` |
| `dbuId` | Numeric DBU club ID (used as logo filename) |
| `primaryColor` | Primary brand colour as hex — `null` until manually set |
| `secondaryColor` | Secondary brand colour as hex — `null` until manually set |
| `kitStyle` | Kit pattern — `null` until set. One of: `regular`, `vertical-stripes`, `horizontal-stripes`, `half-split` |
| `logo` | Path to logo file — `null` until added to `assets/logos/` |

### Kit styles

| Value | Description |
|---|---|
| `regular` | Solid primary colour, sleeves in secondary |
| `vertical-stripes` | Vertical stripes alternating primary and secondary |
| `horizontal-stripes` | Horizontal stripes alternating primary and secondary |
| `half-split` | Left half primary, right half secondary |

### Logo architecture

Logos are **not** bundled in this library. They live in a separate private store and are served by `dbuId`. Consuming apps provide a base URL and resolve logo URLs at runtime:

```js
function getLogoUrl(dbuId, baseUrl) {
  return dbuId ? `${baseUrl}/${dbuId}.png` : null;
}
```

This keeps the library open-source and dependency-free while letting each app control its own logo hosting.

---

## Exports (`index.js`)

All exports are pure functions or static data — no side effects, no network calls.

### `clubs`
The full array of 696 club objects.

### `getClub(name)`
Exact-name lookup. Returns the matching club or a fallback stub if not found:
```js
{ name, color: '#6b7280', city: '', postal: '', region: '', dbuId: null, logo: null }
```

### `clubAbbreviation(name)`
Derives a short abbreviation using DBU naming conventions:

| Pattern | Rule | Example |
|---|---|---|
| `FC ...` | FC + first letter | FC København → FCK |
| `BK ...` / `Boldklubben ...` | BK + first letter | Boldklubben Vestia → BKV |
| `... IF / GF / GIF / GI / IK / SK / BK` | First letter + suffix | Vanløse IF → VIF |
| Letter prefix + number | Keep as-is | B 1909 → B1909, BK 96 → BK96 |
| Fallback | Initials of first 3 words (skipping numbers) | Christiania Sports Club → CSC |

### `clubBadgeSvg(name)`
Returns an SVG string — a light grey circle (`#ebebeb`) with the abbreviation in muted grey (`#6b7280`). Font size scales with abbreviation length (2 chars → 42px, 5+ chars → 23px).

### `clubBadgeUrl(name)`
Returns a `data:image/svg+xml,...` URL — drop directly into an `<img src>`.

### `clubInitials(name)`
Two-letter initials (first letter of first two words). Legacy helper, prefer `clubAbbreviation`.

### `getULevel(birthYear)`
DBU age-group string from birth year:

| Age | Returns |
|---|---|
| ≤ 7 | `"U7"` |
| ≤ 10 | `"U10"` |
| ≤ 12 | `"U12"` |
| 13+ | `"U13+"` |

### `getMatchFormat(birthYear)`
Match format from birth year: `"3v3"`, `"5v5"`, `"8v8"`, `"11v11"`.

---

## Scripts

```bash
npm run scrape   # Fetch all clubs from dbu.dk → clubs.json  (~60–90 min)
npm run build    # clubs.json → index.js
npm run logos    # Scan assets/logos/ → update clubs.json + rebuild index.js
npm run figma    # Generate figma-plugin/code.js for the badge artboard generator
```

See `SCRAPING.md` for the full update workflow.

### Playwright (scraping only)

Playwright is **not** listed as a dependency — it's only needed locally when re-scraping, and its `postinstall` hook downloads ~300MB of browser binaries which would break `npm install` in consuming projects.

Install it manually before scraping, then remove it when done:

```bash
npm install playwright
npx playwright install chromium
npm run scrape
npm uninstall playwright
```

---

## Logo workflow

1. Design or export logos as PNG named by `dbuId` (e.g. `1567.png`)
2. Drop files into `assets/logos/`
3. Run `npm run logos` — updates `clubs.json` and rebuilds `index.js`

The Figma plugin (`npm run figma` → run in Figma desktop) generates one 500×500 artboard per club, grouped by starting letter. Mark a frame as export-ready by adding an export setting in Figma's right panel. `File → Export` then only exports finished badges.

---

## Usage in other projects

Install directly from GitHub (no npm account needed):

```bash
npm install github:rasmuslandgreen/danish-football-clubs
```

Then import normally:

```js
import { clubs, getClub, clubBadgeUrl, getULevel, getMatchFormat } from 'danish-football-clubs';
```

To update to the latest version in a consuming project:

```bash
npm update danish-football-clubs
```

### Badge rendering pattern

```js
// Use logo if available, SVG badge otherwise — same <img> tag either way
const src = club.logo
  ? club.logo
  : clubBadgeUrl(club.name);

// <img src={src} alt={club.name} />
```

### Stored shape when user selects a club

```json
{ "clubName": "Vanløse IF", "clubId": 1545, "clubSource": "dbu" }
```

Custom club (typed but not found in list):

```json
{ "clubName": "Himmelev Boldklub", "clubId": null, "clubSource": "custom" }
```

---

## What is not implemented

| Item | Notes |
|---|---|
| `shortName` field | Not exposed by DBU — abbreviation is derived at runtime |
| `color` field | All `null` — would need manual assignment or a separate source |
| Fuzzy search | Demo uses `.includes()` — implement with fuse.js or similar in consuming apps |
| "Use [typed text]" option | Custom club fallback — implement in the app's autocomplete UI |
| Logo scraping | DBU pages don't expose logos publicly |
| Automatic re-scrape | Manual yearly process — see SCRAPING.md |
