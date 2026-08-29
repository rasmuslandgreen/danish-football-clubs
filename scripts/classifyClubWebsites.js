#!/usr/bin/env node
/**
 * classifyClubWebsites.js  (ES module)
 * ------------------------------------------------------------------
 * Klassificerer hver klubs hjemmeside som:
 *   - "dbu-klubcms"  : bygget på DBU's Klub-CMS (Umbraco-skabelon)
 *   - "custom"       : egen løsning (WordPress, Wix, SPA, m.fl.)
 *   - "unknown"      : ingen klare signaler
 *   - "unreachable"  : kunne ikke hentes
 *
 * Formål: finde klubber med egen løsning = kandidater til at kontakte
 * (validerer "Problem 3" i pitch-vidensdokumentet).
 *
 * Fingeraftrykket er udledt ved at sammenligne kendte sites:
 *   DBU Klub-CMS : vanloeseif.dk, abtaarnby.dk, alleroedfk.dk, agf1880fodbold.dk
 *   Egen løsning : vestia.dk (SPA), aik65fodbold.dk (WordPress)
 *
 * Kør:  node scripts/classifyClubWebsites.js
 * Valgfrit: node scripts/classifyClubWebsites.js --limit 50 --concurrency 8
 *
 * Output:
 *   clubsCmsClassification.json  (alle resultater + matchede signaler)
 *   clubsCmsClassification.csv   (regneark-venlig)
 * ------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ---- argumenter ----
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const LIMIT = parseInt(getArg("--limit", "0"), 10); // 0 = alle
const CONCURRENCY = parseInt(getArg("--concurrency", "8"), 10);
const TIMEOUT_MS = parseInt(getArg("--timeout", "15000"), 10);

const clubs = JSON.parse(fs.readFileSync(path.join(ROOT, "clubs.json"), "utf8"));

// ---- fingeraftryk-regler ----
// Returnerer { platform, classification, signals[], confidence }
function classifyHtml(html, finalUrl, hostname) {
  const signals = [];
  const lower = html.toLowerCase();

  // -------- Egen løsning: kendte platforme (stærke negative for DBU) --------
  const platformMarkers = [
    { re: /wp-content\/|wp-json|wp-includes/i, platform: "WordPress" },
    { re: /<meta[^>]+name=["']generator["'][^>]+wordpress/i, platform: "WordPress" },
    { re: /wp rocket|wp-rocket/i, platform: "WordPress (WP Rocket)" },
    { re: /static\.parastorage\.com|wix\.com|wixstatic/i, platform: "Wix" },
    { re: /squarespace\.com|static1\.squarespace/i, platform: "Squarespace" },
    { re: /cdn\.shopify\.com|shopify/i, platform: "Shopify" },
    { re: /typo3/i, platform: "TYPO3" },
    { re: /drupal/i, platform: "Drupal" },
    { re: /joomla/i, platform: "Joomla" },
    { re: /_next\/static|__next|nuxt|data-reactroot|id=["']root["']/i, platform: "SPA/JS-framework" },
  ];
  let platform = null;
  for (const m of platformMarkers) {
    if (m.re.test(html)) { platform = m.platform; signals.push("platform:" + m.platform); break; }
  }

  // generator-tag generelt (DBU Klub-CMS sætter IKKE generator)
  const genMatch = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i);
  if (genMatch) signals.push("generator:" + genMatch[1].trim());

  // -------- DBU Klub-CMS positive markører --------
  let cmsScore = 0;
  // 1) Umbraco-mediesti på klubbens eget domæne: /media/<tal>/
  const hostEsc = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`https?://[^"']*${hostEsc}/media/\\d+/`, "i").test(html)
      || /["'(]\/media\/\d+\//i.test(html)) {
    cmsScore += 2; signals.push("umbraco-media-path");
  }
  // 2) Eksakt DBU-skabelon viewport
  if (/width=device-width,initial-scale=1,maximum-scale=1/i.test(html)) {
    cmsScore += 1; signals.push("dbu-viewport");
  }
  // 3) Indlejret DBU kampdata
  if (/file\.dbu\.dk\/images\/club\//i.test(html)) { cmsScore += 2; signals.push("file.dbu.dk-club-logos"); }
  if (/kampvisning\?poolrowid=/i.test(html)) { cmsScore += 2; signals.push("kampvisning-poolrowid"); }
  if (/resources\/images\/kampfakta/i.test(html)) { cmsScore += 1; signals.push("kampfakta-resource"); }
  // 4) Template-rester
  if (/mailto:dbu@dbu\.dk/i.test(lower)) { cmsScore += 1; signals.push("template-default-dbu-mail"); }

  // -------- afgørelse --------
  let classification;
  let confidence;
  if (platform && cmsScore < 2) {
    classification = "custom";
    confidence = platform.startsWith("WordPress") || platform === "Wix" || platform === "Squarespace" ? "high" : "medium";
  } else if (cmsScore >= 3) {
    classification = "dbu-klubcms";
    confidence = "high";
  } else if (cmsScore === 2) {
    classification = "dbu-klubcms";
    confidence = "medium";
  } else if (platform) {
    classification = "custom";
    confidence = "medium";
  } else {
    classification = "unknown";
    confidence = "low";
  }

  return { platform: platform || (cmsScore >= 2 ? "DBU Klub-CMS (Umbraco)" : null), classification, signals, confidence };
}

// ---- hentning ----
async function fetchSite(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; club-cms-classifier/1.0)" },
    });
    const html = await res.text();
    return { ok: true, status: res.status, finalUrl: res.url, html };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

function normalizeUrl(u) {
  if (!/^https?:\/\//i.test(u)) return null;
  return u.trim();
}

async function run() {
  let targets = clubs.filter((c) => c.website && normalizeUrl(c.website));
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  console.log(`Klassificerer ${targets.length} klub-hjemmesider (concurrency ${CONCURRENCY})...`);

  const results = [];
  let done = 0;
  let idx = 0;

  async function worker() {
    while (idx < targets.length) {
      const club = targets[idx++];
      const url = normalizeUrl(club.website);
      let hostname = "";
      try { hostname = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
      const r = await fetchSite(url);
      let row;
      if (!r.ok) {
        row = { name: club.name, website: club.website, classification: "unreachable", platform: null, confidence: "n/a", signals: [r.error] };
      } else {
        const c = classifyHtml(r.html || "", r.finalUrl, hostname);
        // tom/meget kort body uden markører => sandsynlig SPA/custom
        if (c.classification === "unknown" && (r.html || "").replace(/\s/g, "").length < 1500) {
          c.classification = "custom"; c.platform = c.platform || "SPA/tom HTML"; c.confidence = "low"; c.signals.push("empty-or-spa-shell");
        }
        row = { name: club.name, website: club.website, status: r.status, classification: c.classification, platform: c.platform, confidence: c.confidence, signals: c.signals };
      }
      results.push(row);
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // ---- opsummering ----
  const by = (k) => results.filter((r) => r.classification === k).length;
  const summary = {
    total: results.length,
    dbuKlubcms: by("dbu-klubcms"),
    custom: by("custom"),
    unknown: by("unknown"),
    unreachable: by("unreachable"),
  };
  console.log("\n=== RESULTAT ===");
  console.log(summary);
  const reachable = summary.total - summary.unreachable;
  if (reachable > 0) {
    console.log(`Andel egen løsning (af kontaktbare): ${((summary.custom / reachable) * 100).toFixed(1)}%`);
  }

  // ---- skriv filer ----
  fs.writeFileSync(path.join(ROOT, "clubsCmsClassification.json"), JSON.stringify({ summary, results }, null, 2));
  const esc = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const csv = ["name,website,classification,platform,confidence,signals"]
    .concat(results.map((r) => [r.name, r.website, r.classification, r.platform, r.confidence, (r.signals || []).join("; ")].map(esc).join(",")))
    .join("\n");
  fs.writeFileSync(path.join(ROOT, "clubsCmsClassification.csv"), csv);

  // ---- kandidatliste (egen løsning, høj/medium tillid) ----
  const candidates = results
    .filter((r) => r.classification === "custom" && r.confidence !== "low")
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
  console.log(`\n=== KANDIDATER MED EGEN LØSNING (${candidates.length}) ===`);
  candidates.slice(0, 40).forEach((r) => console.log(`  ${r.name}  —  ${r.website}  [${r.platform || "?"}]`));
  if (candidates.length > 40) console.log(`  ... og ${candidates.length - 40} flere (se CSV)`);

  console.log("\nSkrevet: clubsCmsClassification.json + .csv");
}

run().catch((e) => { console.error(e); process.exit(1); });
