# danish-football-clubs

A dataset and utility library of 1,540 Danish football clubs, scraped from [dbu.dk](https://www.dbu.dk): names, locations, colours, kits, contact details and, for 978 clubs, the club crest. It also provides club-coloured badge fallbacks and DBU age-group helpers for football apps.

Built for and used in [Opstillingen.dk](https://opstillingen.dk), a lineup builder for Danish youth football coaches, and [Findenklub.dk](https://findenklub.dk).

## Using it

### From the CDN (how the apps load it)

Every release is a git tag, served by jsDelivr. Always pin a version:

```js
const CDN = 'https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.2.32';
const clubs = await (await fetch(`${CDN}/clubs.json`)).json();
```

### As a package

```bash
npm install github:rasmuslandgreen/danish-football-clubs
```

```js
import { clubs, getClub, clubBadgeUrl, clubAbbreviation, getULevel, getMatchFormat, distanceBetweenClubs } from 'danish-football-clubs';
```

## Logos

Crests are hosted on GitHub Pages, not in the version tags. Each logo has two URLs in the data:

| Field | What |
|---|---|
| `logoThumbUrl` | 160×160 WebP, about 2–5 KB. Use this for avatars. |
| `logoUrl` | 500×500 PNG, for larger display. |
| `logo` | Older path relative to the CDN (`assets/logos/{dbuId}.png`). Kept as a fallback. |

File names include a hash of the image (`thumb/1595-4a57eb69d6.webp`), so a URL only changes when the logo itself changes. Browsers can cache logos indefinitely, and a new release doesn't make anyone download unchanged logos again.

```js
const club = getClub('Østerbro Idræts Forening');
const src = club.logoThumbUrl ?? clubBadgeUrl(club.name, club);
// <img src={src} alt={club.name} />
```

Use `logoThumbUrl` first, and fall back to `${CDN}/${club.logo}` if it fails to load. If a page has a Content-Security-Policy, add `https://rasmuslandgreen.github.io` to `img-src`.

### Badge fallback

When a club has no logo, `clubBadgeUrl(name, colors?)` returns an SVG data URL: a circle with the club's abbreviation. Pass `{ primaryColor, secondaryColor }` (or the club object) to get a badge in the club's colours. Without colours it renders a neutral grey badge.

```js
clubBadgeUrl('Egebjerg IF');                                  // grey "EIF"
clubBadgeUrl('Egebjerg IF', { primaryColor: '#0057B8' });     // white "EIF" on blue
```

## Club lookup

```js
getClub('Brøndby IF');   // exact name
getClub('Øst møn');      // also matches a club's aliases, ignoring case → Østmøn SGI
```

`getClub` returns a stub with `dbuId: null` when nothing matches. `aliases` are names users have typed for a club; see [WORKFLOW.md](./WORKFLOW.md#linking-a-typed-club-name-aliases).

### Abbreviations and age groups

```js
clubAbbreviation('FC København');      // FCK
clubAbbreviation('Boldklubben Vestia'); // BKV
clubAbbreviation('B 1909');            // B1909

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
  "name":           "Østmøn SGI",
  "city":           "Stege",
  "postal":         "4780",
  "region":         "Sjælland",
  "dbuId":          1328,
  "primaryColor":   "#cc0000",
  "secondaryColor": "#0055a4",
  "kitStyle":       null,
  "logo":           "assets/logos/1328.png",
  "logoUrl":        "https://rasmuslandgreen.github.io/danish-football-clubs/full/1328-0ffc4bd146.png",
  "logoThumbUrl":   "https://rasmuslandgreen.github.io/danish-football-clubs/thumb/1328-0ffc4bd146.webp",
  "aliases":        ["Øst møn"],
  "municipality":   "Vordingborg",
  "coords":         [54.9362949, 12.31627561]
}
```

| Field | Description |
|---|---|
| `region` | `Hovedstaden`, `Sjælland`, `Fyn`, `Jylland`, `Bornholm` or `Ukendt` |
| `primaryColor` / `secondaryColor` | Club colours as hex, or `null` |
| `kitStyle` | Kit pattern, or `null` |
| `logo` / `logoUrl` / `logoThumbUrl` | See [Logos](#logos). All `null` when the club has no crest. |
| `aliases` | Typed names that should match this club |
| `coords` | `[lat, lng]`, used by `distanceBetweenClubs` |

The data also includes contact details (`email`, `website`, `phone`) and kit colours (`kitHome*`, `kitAway*`).

## Maintaining the data

See [WORKFLOW.md](./WORKFLOW.md) for the full process. In short:

```bash
npm run logos:pipeline   # find, collect, judge (Claude) and prepare logos for clubs without one
npm run logos:export     # export reviewed logos from Figma, publish them to GitHub Pages, rebuild
npm run build            # clubs.json → index.js
npm run editor           # Klub Editor: edit clubs, review kit contributions, release ("Udgiv")
npm run scrape           # re-scrape dbu.dk → clubs.json (~60–90 min, needs Playwright)
```

`clubs.json` is the source of truth. `index.js` is generated, so never edit it by hand. Releases are made with the Udgiv button in the Klub Editor. It publishes new logos, bumps the version, tags it, warms the CDN and updates the version in the consuming apps.

See [SCRAPING.md](./SCRAPING.md) for scraping details and [ARCHITECTURE.md](./ARCHITECTURE.md) for the design.

## License

MIT © [Rasmus Landgreen](https://github.com/rasmuslandgreen)
