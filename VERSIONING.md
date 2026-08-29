# Versioning — danish-football-clubs

How to release updates to the library, and how consuming projects pick them up.

---

## The normal workflow: use the editor

`npm run editor` opens the visual editor at `localhost:3737`.

The green **"Udgiv"** button at the bottom handles the entire release in one click. It runs these steps in sequence and streams the output so you can see what's happening:

1. **Gem ændringer i klub-data og logoer** — commits any unsaved changes to `clubs.json` and `assets/logos/`
2. **Byg genererede filer** — rebuilds `index.js` from `clubs.json`, and rebuilds `bydel.js` / `teams.js` if their source files (`bydel.json` / `teams.json`) exist
3. **Bump version** — increments the patch version in `package.json` (e.g. `1.1.11` → `1.1.12`)
4. **Commit og tag** — commits all generated files and tags the commit with the new version number
5. **Push til GitHub** — pushes the commit and the version tag to GitHub. jsDelivr picks up the new tag automatically within a few minutes
6. **Opdater Opstillingen** — finds the CDN version string in `opstillingen/src/utils/klub-combobox.js` and bumps it to the new version, then commits and pushes Opstillingen
7. **Opdater findenklub** — same for findenklub, once it's wired up (currently a no-op; see `FINDENKLUB_APP_PATH` in `scripts/editor-server.js`)

If any step fails, the pipeline stops and shows the error in red. Fix the issue and click Udgiv again — it picks up where it left off cleanly because git won't re-commit things that are already committed.

---

## How it works in plain terms

The library lives on GitHub. Consuming projects (Opstillingen, findenklub, etc.) don't fetch code from this folder — they fetch it from GitHub directly, using a URL that includes a version number.

When you update the library, nothing changes for consumers automatically. They stay on whatever version they're pinned to until you explicitly update that version number in their code.

This is intentional. It means you can work freely on the library without fear of breaking a live site. The editor's Udgiv button is what moves consumers forward.

---

## The version number

The version lives in `package.json`:

```json
"version": "1.1.11"
```

It follows the pattern `MAJOR.MINOR.PATCH`:

| Change type | What happened | Example |
|---|---|---|
| PATCH (`1.1.11` → `1.1.12`) | Data update, bug fix, new data added to existing fields | Added more club logos, fixed a wrong phone number |
| MINOR (`1.1.x` → `1.2.0`) | New feature added, nothing removed or renamed | Added `teams.js` slice, added `email` field to clubs |
| MAJOR (`1.x.x` → `2.0.0`) | Something was renamed, removed, or changed in a breaking way | Renamed `color` to `primaryColor` |

In practice: bump PATCH for data refreshes, MINOR when you add new exports or fields, MAJOR only when you change or remove something existing.

---

## Releasing manually (without the editor)

Use this when you've done something the editor doesn't cover — a major structural change, a new script, etc.

1. **Make your changes** — edit `clubs.json`, run scripts, whatever the update requires
2. **Rebuild the generated files**
   ```bash
   npm run build        # rebuilds index.js from clubs.json
   npm run build-bydel  # rebuilds bydel.js (if bydel.json exists)
   npm run build-teams  # rebuilds teams.js (if teams.json exists)
   ```
3. **Bump the version in `package.json`** — edit the `"version"` field manually
4. **Commit everything**
   ```bash
   git add clubs.json index.js bydel.js teams.js package.json assets/logos/
   git commit -m "v1.2.0 — describe what changed"
   git tag v1.2.0
   ```
5. **Push to GitHub**
   ```bash
   npm run release
   ```
   That command runs: `git push origin main && git push origin v1.2.0`
6. **Update each consuming project** — bump the version tag in their CDN URL (see below)

Once the tag exists on GitHub, jsDelivr serves it automatically within a few minutes at:
```
https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.2.0/index.js
```

---

## Wiring up a new consumer to the editor

When a new project starts using the library, add it to the editor's release pipeline so Udgiv updates it automatically.

In `scripts/editor-server.js`, near the top:

```js
// Change this:
const FINDENKLUB_APP_PATH = null;

// To the path of the file containing the CDN URL, e.g.:
const FINDENKLUB_APP_PATH = path.resolve(__dirname, '../../findenklub/src/app.js');
```

The file must contain a string matching `danish-football-clubs@vX.Y.Z` — the editor does a simple find-and-replace on that pattern. Make sure the CDN import in the new project follows the same format as Opstillingen.

---

## How consuming projects update

### Opstillingen (CDN)

Opstillingen loads the library via a CDN URL in [`src/utils/klub-combobox.js`](src/utils/klub-combobox.js):

```js
const _CLUBS_CDN = 'https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.1.11';
```

To update Opstillingen to a new version, change that version tag — one line, one file:

```js
const _CLUBS_CDN = 'https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.2.0';
```

That's it. Opstillingen fetches `clubs.json` and logo images from this same base URL, so updating the tag updates everything at once.

### findenklub and future projects (also CDN)

Same pattern. Each project has a CDN base URL with a version tag. Update the tag when you're ready for that project to get the new version.

### If a project used npm install (not currently the case)

```bash
npm update danish-football-clubs
```

---

## What could break in Opstillingen

Opstillingen uses the library in two ways:

**1. Fetches `clubs.json` directly**
```js
const _CLUBS_URL = `${_CLUBS_CDN}/clubs.json`;
```
It reads these fields from each club: `name`, `dbuId`, `primaryColor`, `secondaryColor`, `logo`.

If any of those field names change, the app breaks silently — clubs render without colours or logos.

**2. Fetches logo images by path**
```js
`${_CLUBS_CDN}/${logo}` // e.g. assets/logos/3700.png
```
If the `assets/logos/` folder is renamed or logos are moved, images stop loading.

**3. Imports utility functions**
Opstillingen uses `getClub`, `clubBadgeUrl`, and potentially `clubBadgeSvg` via CDN. If these are renamed or removed, the club picker breaks.

---

## Safe vs. breaking changes

| Change | Safe? | Notes |
|---|---|---|
| Adding new fields to club objects | ✅ Safe | Consumers ignore fields they don't use |
| Adding new exports to index.js | ✅ Safe | Consumers ignore exports they don't import |
| Adding new slices (teams.js, bydel.js) | ✅ Safe | Only loaded if a project imports them |
| Updating data (emails, websites, kit colours) | ✅ Safe | Same shape, new values |
| Adding new logos | ✅ Safe | New images at the same path pattern |
| **Renaming a field** (e.g. `color` → `primaryColor`) | ❌ Breaking | Any project reading the old field gets `undefined` |
| **Renaming an export** (e.g. `getClub` → `findClub`) | ❌ Breaking | Any project importing the old name gets an error |
| **Removing a field or export** | ❌ Breaking | Same as renaming |
| **Moving logo files** to a different path | ❌ Breaking | All logo images in consumers go 404 |

Before making a breaking change: check each consuming project for usages of the thing you're changing. In Opstillingen, search `klub-combobox.js`.

---

## Checking what version a project is on

Look for the CDN URL in the project's JS files:

```bash
grep -r "danish-football-clubs" opstillingen/src
```

The version tag in that URL is what the project is currently using.

---

## If something breaks after an update

The old version is still available on jsDelivr forever. Roll back by reverting the version tag in the consuming project's CDN URL:

```js
// Roll back to the last working version
const _CLUBS_CDN = 'https://cdn.jsdelivr.net/gh/rasmuslandgreen/danish-football-clubs@v1.1.11';
```

No data is lost. The old tag stays on GitHub and jsDelivr keeps serving it.
