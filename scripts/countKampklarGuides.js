#!/usr/bin/env node
/**
 * countKampklarGuides.js  (ES module)
 * ------------------------------------------------------------------
 * Optæller klubber, der har lavet deres EGEN KampKlar-vejledning.
 *
 * Idé: en klub med egen guide linker typisk en side på sit EGET domæne
 * (fx "/medlemskab/kampklar-vejledning/"), mens andre blot linker ud til
 * mit.dbu.dk / klubservice.dbu.dk. Vi henter hver forside, finder
 * KampKlar-links og klassificerer klubben.
 *
 * Kategorier pr. klub:
 *   - "egen-guide"        : egen-domæne KampKlar-side MED guide-ord (vejledning/guide/kom-i-gang/sådan)
 *   - "egen-kampklar-side": egen-domæne KampKlar-side uden guide-ord (måske guide, måske kun info)
 *   - "kun-link-til-dbu"  : linker kun til dbu.dk/mit.dbu.dk om KampKlar
 *   - "ingen-paa-forside"  : ingen KampKlar-omtale på forsiden (kan stadig findes dybere)
 *   - "unreachable"
 *
 * BEMÆRK: kun forsiden tjekkes => dette er et UNDERESTIMAT (guider, der ikke
 * er linket fra forsiden, tælles ikke). Brug --deep til at hente kandidat-
 * siden og verificere, at den ligner en guide (flere trin/billeder/"sådan").
 *
 * Kør:  node scripts/countKampklarGuides.js
 *       node scripts/countKampklarGuides.js --limit 50 --deep
 * Output: kampklarGuides.json + kampklarGuides.csv
 * ------------------------------------------------------------------
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const LIMIT = parseInt(getArg("--limit", "0"), 10);
const CONCURRENCY = parseInt(getArg("--concurrency", "8"), 10);
const TIMEOUT_MS = parseInt(getArg("--timeout", "15000"), 10);
const DEEP = args.includes("--deep");

const clubs = JSON.parse(fs.readFileSync(path.join(ROOT, "clubs.json"), "utf8"));

const GUIDE_WORDS = /(vejledning|guide|kom[\s-]?i[\s-]?gang|how[\s-]?to|s[åa]dan|brugerguide|hj[æae]lp)/i;
const DBU_HOSTS = /(^|\.)(dbu\.dk|mitdbu\.dk|mit\.dbu\.dk|klubservice\.dbu\.dk)$/i;

function regDomain(hostname) {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

async function fetchSite(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; kampklar-guide-counter/1.0)" } });
    const html = await res.text();
    return { ok: true, status: res.status, finalUrl: res.url, html };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally { clearTimeout(t); }
}

// træk alle <a href ...>tekst</a> ud
function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let abs;
    try { abs = new URL(href, baseUrl); } catch (e) { continue; }
    links.push({ href, text, url: abs });
  }
  return links;
}

function classifyHomepage(html, clubUrl) {
  const base = new URL(clubUrl);
  const ownDomain = regDomain(base.hostname);
  const links = extractLinks(html, clubUrl);

  const kkLinks = links.filter((l) => /kampklar/i.test(l.href) || /kampklar/i.test(l.text));
  if (kkLinks.length === 0) {
    // måske nævnt i brødtekst men ikke som link
    const mentioned = /kampklar/i.test(html);
    return { category: mentioned ? "ingen-paa-forside" : "ingen-paa-forside", matches: [] };
  }

  const ownKk = kkLinks.filter((l) => regDomain(l.url.hostname) === ownDomain && !DBU_HOSTS.test(l.url.hostname));
  const ownGuide = ownKk.filter((l) => GUIDE_WORDS.test(l.href) || GUIDE_WORDS.test(l.text));

  let category;
  if (ownGuide.length) category = "egen-guide";
  else if (ownKk.length) category = "egen-kampklar-side";
  else category = "kun-link-til-dbu";

  const matches = (ownGuide.length ? ownGuide : ownKk.length ? ownKk : kkLinks)
    .slice(0, 3).map((l) => ({ text: l.text, url: l.url.href }));
  return { category, matches };
}

// valgfri dybde-tjek: ligner kandidatsiden en guide?
function looksLikeGuide(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const imgCount = (html.match(/<img\b/gi) || []).length;
  const steps = (text.match(/\b(trin|step|\d+\.\s)/gi) || []).length;
  const words = GUIDE_WORDS.test(text);
  const longEnough = text.replace(/\s+/g, " ").length > 800;
  // heuristik: guide-ord + (mange billeder eller flere trin) + rimelig længde
  return words && longEnough && (imgCount >= 2 || steps >= 3);
}

async function run() {
  let targets = clubs.filter((c) => c.website && /^https?:\/\//i.test(c.website));
  if (LIMIT > 0) targets = targets.slice(0, LIMIT);
  console.log(`Tjekker ${targets.length} klub-forsider for egne KampKlar-guider (concurrency ${CONCURRENCY}${DEEP ? ", deep" : ""})...`);

  const results = [];
  let idx = 0, done = 0;

  async function worker() {
    while (idx < targets.length) {
      const club = targets[idx++];
      const url = club.website.trim();
      const r = await fetchSite(url);
      let row;
      if (!r.ok) {
        row = { name: club.name, website: club.website, category: "unreachable", matches: [], error: r.error };
      } else {
        const c = classifyHomepage(r.html || "", r.finalUrl || url);
        row = { name: club.name, website: club.website, category: c.category, matches: c.matches };
        if (DEEP && (c.category === "egen-guide" || c.category === "egen-kampklar-side") && c.matches[0]) {
          const d = await fetchSite(c.matches[0].url);
          row.deepLooksLikeGuide = d.ok ? looksLikeGuide(d.html || "") : null;
        }
      }
      results.push(row);
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const by = (k) => results.filter((r) => r.category === k).length;
  const summary = {
    total: results.length,
    egenGuide: by("egen-guide"),
    egenKampklarSide: by("egen-kampklar-side"),
    kunLinkTilDbu: by("kun-link-til-dbu"),
    ingenPaaForside: by("ingen-paa-forside"),
    unreachable: by("unreachable"),
  };
  if (DEEP) summary.deepVerifiedGuides = results.filter((r) => r.deepLooksLikeGuide === true).length;

  console.log("\n=== RESULTAT (kun forside => underestimat) ===");
  console.log(summary);
  const egenSamlet = summary.egenGuide + summary.egenKampklarSide;
  console.log(`Klubber med egen KampKlar-side på eget domæne: ${egenSamlet} (heraf ${summary.egenGuide} med tydeligt guide-ord)`);

  fs.writeFileSync(path.join(ROOT, "kampklarGuides.json"), JSON.stringify({ summary, results }, null, 2));
  const esc = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const csv = ["name,website,category,deepLooksLikeGuide,matchUrl,matchText"]
    .concat(results.map((r) => [r.name, r.website, r.category, r.deepLooksLikeGuide ?? "", r.matches?.[0]?.url ?? "", r.matches?.[0]?.text ?? ""].map(esc).join(",")))
    .join("\n");
  fs.writeFileSync(path.join(ROOT, "kampklarGuides.csv"), csv);

  const list = results.filter((r) => r.category === "egen-guide").sort((a, b) => a.name.localeCompare(b.name, "da"));
  console.log(`\n=== KLUBBER MED EGEN GUIDE (${list.length}) ===`);
  list.slice(0, 40).forEach((r) => console.log(`  ${r.name}  —  ${r.matches?.[0]?.url || ""}`));
  if (list.length > 40) console.log(`  ... og ${list.length - 40} flere (se CSV)`);
  console.log("\nSkrevet: kampklarGuides.json + .csv");
}

run().catch((e) => { console.error(e); process.exit(1); });
