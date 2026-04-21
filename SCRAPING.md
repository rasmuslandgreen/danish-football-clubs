# Scraping Guide

How to update the club dataset, and what happens when you do.

---

## When to run a scrape

The dataset is static — it does not update automatically. Run a new scrape when:

- Clubs have been added or renamed on DBU's systems (typically start of season)
- A club is missing from the autocomplete
- You want to pick up newly registered clubs

Once a year at the start of the season is usually enough.

---

## How to run it

From the project root:

```bash
npm run scrape   # fetches all clubs from dbu.dk → writes clubs.json
npm run build    # reads clubs.json → rewrites index.js
```

`npm run scrape` takes about 60–90 minutes. It opens a real browser, visits each
of the four regional DBU sites (Hovedstaden, Sjælland, Fyn, Jylland), and
walks through thousands of club IDs one by one. A 250 ms pause is added between
requests to be polite to their servers.

`npm run build` is instant — it just converts `clubs.json` into the exported
array in `index.js`.

---

## What happens with existing clubs

The scraper fetches everything fresh each time. It does not merge with the
previous `clubs.json` — it replaces it entirely.

This means:

- **Renamed club** → new name appears, old name disappears automatically
- **Dissolved club** → disappears from the next scrape (DBU removes it)
- **New club** → picked up automatically
- **Manually added color or logo** → **will be lost** (see Logos section below)

---

## Duplicates

The scraper deduplicates by exact club name before writing `clubs.json`.

If the same club name appears across multiple regional sites (which happens
for national-level clubs registered in more than one union), only the first
occurrence is kept.

If two genuinely different clubs share a name (rare but possible — e.g. two
local clubs both called "BK Frem"), only one will appear. This is a known
limitation of name-based deduplication. In practice it has not been an issue.

---

## Logos

All clubs currently have `logo: null`. DBU does not expose logos through their
public pages, so they have to be added manually.

### How to add a logo

1. Save the image to `assets/logos/` — name it after the club's `dbuId`:
   ```
   assets/logos/1567.png   ← Kjøbenhavns Boldklub (dbuId 1567)
   ```
2. Edit `clubs.json` and set the `logo` field for that club:
   ```json
   { "name": "Kjøbenhavns Boldklub", "dbuId": 1567, "logo": "assets/logos/1567.png", ... }
   ```
3. Run `npm run build` to update `index.js`.

### Surviving a re-scrape

Because `npm run scrape` overwrites `clubs.json` completely, any logos you have
set will be lost unless you re-apply them afterwards.

**Recommended workflow when logos are in use:**

1. Keep a separate `logos.json` file that maps `dbuId → logo path`
2. After each scrape, run a small merge script that reads `clubs.json` +
   `logos.json` and writes the combined result back to `clubs.json` before
   building

A `scripts/mergeLogs.js` script for this does not exist yet — it is a natural
next step once logos are being actively used.

---

## What gets filtered out

The scraper drops entries that are not football clubs:

| Filtered | Reason |
|---|---|
| Entries containing "Skole" | Primary/secondary schools |
| Entries containing "Gymnasium" | Upper secondary schools |
| Entries containing "Ungdomsskole" | Youth schools |

**Kept intentionally:**

| Kept | Reason |
|---|---|
| Entries containing "Efterskole" | Boarding schools — they field youth football teams and appear in DBU tournaments |

---

## Output files

| File | Description |
|---|---|
| `clubs.json` | Raw scraped data — source of truth, edit this for manual corrections |
| `index.js` | Generated from `clubs.json` — do not edit by hand, it will be overwritten |
