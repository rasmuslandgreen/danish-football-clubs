# danish-football-clubs

A static dataset and utility library of 696 Danish football clubs, scraped from [dbu.dk](https://www.dbu.dk). Provides consistent club naming, SVG badge fallbacks, and DBU age-group utilities for football apps.

Built for and used in [Opstillingen.dk](https://opstillingen.dk) — a lineup builder for Danish youth football coaches.

## Installation

```bash
npm install github:rasmuslandgreen/danish-football-clubs
```

To update to the latest version:

```bash
npm update danish-football-clubs
```

## Usage

```js
import { clubs, getClub, clubBadgeUrl, getULevel, getMatchFormat } from 'danish-football-clubs';
```

### Club data

```js
// Full list of 696 clubs
clubs; // [{ name, city, postal, region, dbuId, color, logo }, ...]

// Exact-name lookup (returns a fallback stub if not found)
const club = getClub('Brøndby IF');
// { name: 'Brøndby IF', city: 'Brøndby', postal: '2605', region: 'Hovedstaden', dbuId: 3700, color: null, logo: null }
```

### Badge rendering

```js
// SVG data URL — drop directly into an <img src>
const src = club.logo ?? clubBadgeUrl(club.name);
// <img src={src} alt={club.name} />
```

When no logo is available, `clubBadgeUrl` returns a light grey circle with the club abbreviation in muted grey — same `<img>` tag either way.

### Abbreviations

```js
import { clubAbbreviation } from 'danish-football-clubs';

clubAbbreviation('FC København');     // FCK
clubAbbreviation('Boldklubben Vestia'); // BKV
clubAbbreviation('Vanløse IF');       // VIF
clubAbbreviation('B 1909');           // B1909
```

### DBU age groups

```js
getULevel(2014);      // 'U12'
getMatchFormat(2014); // '8v8'
```

| Age | U-level | Format |
|-----|---------|--------|
| ≤ 7  | U7  | 3v3   |
| ≤ 10 | U10 | 5v5   |
| ≤ 12 | U12 | 8v8   |
| 13+  | U13+ | 11v11 |

## Club data model

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
| `region` | One of: `Hovedstaden`, `Sjælland`, `Fyn`, `Jylland`, `Bornholm` |
| `primaryColor` | Primary brand colour as hex — `null` until set |
| `secondaryColor` | Secondary brand colour as hex — `null` until set |
| `kitStyle` | `regular`, `vertical-stripes`, `horizontal-stripes`, or `half-split` — `null` until set |
| `logo` | Not bundled — logos are served separately by `dbuId` from your own storage |

## Stored shape (when a user selects a club)

```json
{ "clubName": "Vanløse IF", "clubId": 1545, "clubSource": "dbu" }
```

Custom club (typed but not found in the list):

```json
{ "clubName": "Himmelev Boldklub", "clubId": null, "clubSource": "custom" }
```

## Logo workflow

1. Export logos as PNG named by `dbuId` (e.g. `1567.png`)
2. Drop files into `assets/logos/`
3. Run `npm run logos` — updates `clubs.json` and rebuilds `index.js`

Supported formats: `.png`, `.jpg`, `.jpeg`, `.svg`, `.webp`

## Scripts

```bash
npm run build    # clubs.json → index.js
npm run logos    # Scan assets/logos/ → update clubs.json + rebuild index.js
npm run scrape   # Re-scrape dbu.dk → clubs.json  (~60–90 min, requires Playwright)
npm run figma    # Generate figma-plugin/code.js for the Figma badge artboard plugin
```

See [SCRAPING.md](./SCRAPING.md) for the full update workflow.

## Development

`clubs.json` is the source of truth. `index.js` is generated — never edit it directly.

```
danish-football-clubs/
  index.js          # Generated — do not edit
  clubs.json        # Edit this, then run npm run build
  assets/logos/     # Club logo images, named by dbuId
  scripts/
    scrapeClubs.js
    buildIndex.js
    mergeLogos.js
    buildFigmaPlugin.js
  figma-plugin/     # Generates one artboard per club in Figma
```

## License

MIT © [Rasmus Landgreen](https://github.com/rasmuslandgreen)
