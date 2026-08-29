#!/usr/bin/env node
/**
 * scrapeAppReviews.js  (ES module)
 * ------------------------------------------------------------------
 * Henter anmeldelser af DBU's "Fodbold"-app fra begge platforme og
 * kategoriserer dem (til Problem 2 + det sekundære stabilitets-spor).
 *
 * iOS  : Apples officielle, offentlige RSS-feed (ingen nøgle).
 *        App-id 521095398. Op til ~500 nyeste anmeldelser (10 sider x 50).
 * Android: via npm-pakken `google-play-scraper` (app-id dk.dbu.Fodbold).
 *        Installeres med:  npm i google-play-scraper
 *        Springes over, hvis pakken ikke er installeret.
 *
 * Kør:  node scripts/scrapeAppReviews.js
 *       node scripts/scrapeAppReviews.js --countries dk
 *
 * Output: appReviews.json + appReviews.csv + en optælling i terminalen.
 * ------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const APPLE_ID = getArg("--appleId", "521095398");
const PLAY_ID = getArg("--playId", "dk.dbu.Fodbold");
const COUNTRIES = getArg("--countries", "dk").split(",").map((s) => s.trim());

// ---- kategorisering (gennemsigtig, juster frit) ----
const CATS = [
  { key: "ux_findbarhed", re: /(forvirrende|confusing|kan ikke finde|finder ikke|uoverskuelig|un[øo]verskuelig|besv[æae]rlig|b[øo]vlet|rodet|sv[æae]r at|hard to use|ulogisk|layout|design|uintuitiv|kompliceret|complicated)/i },
  { key: "nedbrud_fejl", re: /(crasher|crash|lukker (ned|sig)|fryser|g[åa]r ned|nedbrud|virker ikke|fungerer ikke|doesn'?t work|fejl|bug|loader( ikke)?|hænger|langsom|slow)/i },
  { key: "notifikationer", re: /(notifikation|notifikationer|besked(er)?|p[åa]mindelse|push)/i },
  { key: "sprog", re: /(engelsk|p[åa] dansk|sprog|language)/i },
  { key: "login_adgang", re: /(log(ge)? ind|login|adgang|password|kode|bruger)/i },
  { key: "ros", re: /(rigtig god|fungerer fint|nem at|fantastisk|super app|elsker|godt v[æae]rkt[øo]j|virker fint)/i },
];
function categorize(text) {
  const hits = [];
  for (const c of CATS) if (c.re.test(text || "")) hits.push(c.key);
  return hits;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; app-review-fetch/1.0)", "Accept": "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

// ---- iOS: Apple RSS ----
async function fetchApple(country) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${APPLE_ID}/sortby=mostrecent/json`;
    let data;
    try { data = await fetchJson(url); } catch (e) { break; }
    const entries = data?.feed?.entry;
    if (!Array.isArray(entries)) break;
    // første entry er app-metadata (har ikke im:rating) -> filtrér
    const reviews = entries.filter((e) => e["im:rating"]);
    if (reviews.length === 0) break;
    for (const e of reviews) {
      out.push({
        platform: "ios",
        country,
        rating: parseInt(e["im:rating"].label, 10),
        version: e["im:version"]?.label || "",
        title: e.title?.label || "",
        text: e.content?.label || "",
        author: e.author?.name?.label || "",
        updated: e.updated?.label || "",
      });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return out;
}

// ---- Android: google-play-scraper (valgfri) ----
async function fetchPlay() {
  let gplay;
  try { gplay = (await import("google-play-scraper")).default || (await import("google-play-scraper")); }
  catch (e) { console.log("ⓘ  Android sprunget over — kør `npm i google-play-scraper` for at inkludere Google Play."); return []; }
  const out = [];
  try {
    let token = null;
    for (let i = 0; i < 10; i++) {
      const res = await gplay.reviews({ appId: PLAY_ID, lang: "da", country: "dk", sort: gplay.sort.NEWEST, num: 150, paginate: true, nextPaginationToken: token });
      const data = res.data || res;
      for (const r of data) out.push({ platform: "android", country: "dk", rating: r.score, version: r.version || "", title: "", text: r.text || "", author: r.userName || "", updated: r.date || "" });
      token = res.nextPaginationToken;
      if (!token || data.length === 0) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) { console.log("ⓘ  Google Play-fejl:", e.message); }
  return out;
}

function summarize(reviews) {
  const n = reviews.length;
  const dist = [0, 0, 0, 0, 0, 0];
  let sum = 0;
  const catCount = {};
  const verCount = {};
  for (const r of reviews) {
    if (r.rating >= 1 && r.rating <= 5) { dist[r.rating]++; sum += r.rating; }
    for (const c of categorize((r.title + " " + r.text))) catCount[c] = (catCount[c] || 0) + 1;
    if (r.version) verCount[r.version] = (verCount[r.version] || 0) + 1;
  }
  return {
    total: n,
    gennemsnit: n ? +(sum / n).toFixed(2) : 0,
    fordeling: { "5": dist[5], "4": dist[4], "3": dist[3], "2": dist[2], "1": dist[1] },
    andel1_2stjerner: n ? +(((dist[1] + dist[2]) / n) * 100).toFixed(1) : 0,
    kategorier: catCount,
    topVersioner: Object.entries(verCount).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };
}

async function run() {
  console.log(`Henter App Store-anmeldelser (iOS id ${APPLE_ID}, lande: ${COUNTRIES.join(",")})...`);
  let reviews = [];
  for (const c of COUNTRIES) {
    const r = await fetchApple(c);
    console.log(`  iOS/${c}: ${r.length} anmeldelser`);
    reviews = reviews.concat(r);
  }
  const play = await fetchPlay();
  if (play.length) console.log(`  Android: ${play.length} anmeldelser`);
  reviews = reviews.concat(play);

  const summary = summarize(reviews);
  console.log("\n=== OPSUMMERING ===");
  console.log(summary);

  // andel der nævner UX vs fejl vs notifikationer
  const c = summary.kategorier;
  console.log("\nNævner (af " + summary.total + "):");
  Object.entries(c).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${v}  (${((v / summary.total) * 100).toFixed(1)}%)`));

  fs.writeFileSync(path.join(ROOT, "appReviews.json"), JSON.stringify({ summary, reviews }, null, 2));
  const esc = (s) => '"' + String(s ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
  const csv = ["platform,country,rating,version,author,updated,title,text,categories"]
    .concat(reviews.map((r) => [r.platform, r.country, r.rating, r.version, r.author, r.updated, r.title, r.text, categorize(r.title + " " + r.text).join("|")].map(esc).join(",")))
    .join("\n");
  fs.writeFileSync(path.join(ROOT, "appReviews.csv"), csv);
  console.log("\nSkrevet: appReviews.json + .csv");
}

run().catch((e) => { console.error(e); process.exit(1); });
