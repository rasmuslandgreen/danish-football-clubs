// ─── Club data editor — local dev tool ────────────────────────────────────────
// Usage: npm run editor
// Opens a browser UI for editing primaryColor, secondaryColor and kitStyle
// for any club in clubs.json. Writes changes directly to the file.
// The "Udgiv" button bumps the version, pushes to GitHub, and updates opstillingen.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, execSync, spawn } from 'child_process';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const CLUBS_PATH = path.resolve(__dirname, '../clubs.json');

// Load .env for Supabase service key (never committed)
let SUPABASE_URL         = '';
let SUPABASE_SERVICE_KEY = '';
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const url = env.match(/^SUPABASE_URL=(.+)$/m);
  const key = env.match(/^SUPABASE_SERVICE_KEY=(.+)$/m);
  if (url) SUPABASE_URL         = url[1].trim();
  if (key) SUPABASE_SERVICE_KEY = key[1].trim();
}
const PKG_PATH    = path.resolve(__dirname, '../package.json');
const TEAMS_PATH  = path.resolve(__dirname, '../teams.json');
const COMBOBOX_PATH = path.resolve(__dirname, '../../opstillingen/src/utils/klub-combobox.js');
const OPSTILLINGEN_PATH = path.resolve(__dirname, '../../opstillingen');

// Set FINDENKLUB_APP_PATH to the file that contains the CDN URL once findenklub uses the library.
// Example: path.resolve(__dirname, '../../findenklub/src/app.js')
const FINDENKLUB_PATH     = path.resolve(__dirname, '../../findenklub');
const FINDENKLUB_APP_PATH = path.resolve(__dirname, '../../findenklub/src/app.js');
const PORT = 3737;

function getVersion() {
  return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version;
}

const HTML = /* html */`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Klub editor</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }

    body {
      font-family: 'DM Sans', sans-serif;
      -webkit-font-smoothing: antialiased;
      background: #f5f5f5;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ─── Topbar ─────────────────────────────────────────────────────────────── */
    .topbar {
      height: 48px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      flex-shrink: 0;
    }
    .topbar__title { font-size: 14px; font-weight: 600; color: #111; }
    .version-badge {
      font-size: 12px;
      font-weight: 500;
      color: #6b7280;
      background: #f3f4f6;
      padding: 3px 8px;
      border-radius: 20px;
      font-variant-numeric: tabular-nums;
    }

    /* ─── Page content ───────────────────────────────────────────────────────── */
    .page-content { flex: 1; overflow-y: auto; padding: 24px; }
    .content-col {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* ─── Cards ──────────────────────────────────────────────────────────────── */
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 24px;
      box-shadow:
        0px 0px 0px 1px rgba(0, 0, 0, 0.06),
        0px 1px 2px -1px rgba(0, 0, 0, 0.06),
        0px 2px 4px 0px rgba(0, 0, 0, 0.04);
    }
    .card-title {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 16px;
    }
    .card-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      align-items: start;
    }

    /* ─── Empty state ────────────────────────────────────────────────────────── */
    .empty-state {
      background: #fff;
      border-radius: 12px;
      padding: 48px 24px;
      text-align: center;
      box-shadow:
        0px 0px 0px 1px rgba(0, 0, 0, 0.06),
        0px 1px 2px -1px rgba(0, 0, 0, 0.06),
        0px 2px 4px 0px rgba(0, 0, 0, 0.04);
    }
    .empty-state p { color: #9ca3af; font-size: 13px; }

    /* ─── Fields ─────────────────────────────────────────────────────────────── */
    .field { margin-bottom: 16px; }

    label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #6b7280;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    input[type="text"] {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition-property: border-color;
      transition-duration: 0.15s;
    }
    input[type="text"]:focus { border-color: #111; }

    textarea {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: #111;
      outline: none;
      resize: vertical;
      min-height: 70px;
      line-height: 1.5;
      transition-property: border-color;
      transition-duration: 0.15s;
    }
    textarea:focus { border-color: #111; }
    textarea::placeholder { color: #9ca3af; }

    select.form-select {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: #111;
      background: #fff;
      outline: none;
      cursor: pointer;
      transition-property: border-color;
      transition-duration: 0.15s;
    }
    select.form-select:focus { border-color: #111; }

    /* ─── Per-team profil blocks ─────────────────────────────────────────────── */
    .profil-divider {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 4px 0 16px;
    }
    .card-title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .card-title-row .card-title { margin-bottom: 0; }
    .profil-toggle-btn {
      background: none;
      border: none;
      padding: 0;
      font-size: 12px;
      color: #6b7280;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .profil-toggle-btn:hover { color: #111; }
    .team-vl-empty { font-size: 13px; color: #9ca3af; }
    .team-profil-group {
      background: #f9fafb;
      border: 1px solid #f3f4f6;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
    }
    .team-profil-group:last-child { margin-bottom: 0; }
    .team-profil-label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 10px;
    }
    .team-profil-fields { display: flex; gap: 10px; }
    .team-profil-fields .field { flex: 1; margin-bottom: 0; }
    .team-vl-select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
      color: #374151;
      background: #fff;
      outline: none;
      cursor: pointer;
      transition-property: border-color;
      transition-duration: 0.15s;
    }
    .team-vl-select:focus { border-color: #111; }
    .team-kt-input {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      font-size: 13px;
      font-family: inherit;
      color: #374151;
      background: #fff;
      outline: none;
      transition-property: border-color;
      transition-duration: 0.15s;
    }
    .team-kt-input:focus { border-color: #111; }
    .team-kt-input::placeholder { color: #d1d5db; }

    /* ─── Currency input ─────────────────────────────────────────────────────── */
    .currency-wrap { position: relative; display: flex; align-items: center; }
    .currency-wrap input[type="number"] { padding-right: 40px; appearance: textfield; -moz-appearance: textfield; }
    .currency-wrap input[type="number"]::-webkit-inner-spin-button,
    .currency-wrap input[type="number"]::-webkit-outer-spin-button { appearance: none; }
    .currency-suffix {
      position: absolute; right: 12px;
      font-size: 13px; color: #9ca3af; pointer-events: none;
    }
    .team-kt-wrap { position: relative; display: flex; align-items: center; flex: 1; }
    .team-kt-wrap input { padding-right: 36px; }
    .team-kt-wrap .currency-suffix { right: 8px; }

    /* ─── Autocomplete ───────────────────────────────────────────────────────── */
    .ac-wrap { position: relative; }
    .ac-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0; right: 0;
      background: #fff;
      border-radius: 8px;
      box-shadow:
        0px 0px 0px 1px rgba(0, 0, 0, 0.06),
        0px 4px 16px rgba(0, 0, 0, 0.10);
      z-index: 100;
      max-height: 240px;
      overflow-y: auto;
      display: none;
    }
    .ac-item { padding: 9px 12px; font-size: 14px; cursor: pointer; color: #111; }
    .ac-item:hover, .ac-item.active { background: #f3f4f6; }

    /* ─── Color pickers ──────────────────────────────────────────────────────── */
    .colors-row { display: flex; gap: 16px; }
    .color-field { flex: 1; }
    .color-input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }
    .color-input-wrap:focus-within { border-color: #111; }
    input[type="color"] {
      width: 28px; height: 28px;
      border: none; border-radius: 50%; padding: 0;
      cursor: pointer; background: none; flex-shrink: 0;
    }
    .color-hex {
      font-size: 13px; color: #374151; font-family: monospace;
      border: none; outline: none; width: 72px; background: transparent; padding: 0;
    }

    /* ─── Segmented control ──────────────────────────────────────────────────── */
    .seg-ctrl { display: flex; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .seg-btn {
      flex: 1; padding: 8px 4px; font-size: 12px; font-family: inherit; font-weight: 500;
      background: none; border: none; border-right: 1px solid #e5e7eb;
      cursor: pointer; color: #6b7280;
      transition-property: background, color; transition-duration: 0.1s;
    }
    .seg-btn:last-child { border-right: none; }
    .seg-btn.active { background: #111; color: #fff; }

    /* ─── Preview ────────────────────────────────────────────────────────────── */
    .preview { display: flex; align-items: center; justify-content: center; gap: 20px; padding: 8px 0 16px; }
    .preview-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
    .preview-col-label { font-size: 10px; font-weight: 500; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; }
    .preview-avatar {
      width: 56px; height: 56px; border-radius: 50%; object-fit: contain;
      background: #f3f4f6; outline: 1px solid rgba(0,0,0,0.1); outline-offset: -1px; flex-shrink: 0;
    }
    .no-logo-placeholder {
      width: 56px; height: 56px; border-radius: 50%; background: #f9fafb;
      border: 1px dashed #d1d5db; display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: #d1d5db;
    }

    /* ─── Scraped info ───────────────────────────────────────────────────────── */
    .scraped-info {
      background: #f9fafb;
      border-radius: 8px;
      box-shadow: 0px 0px 0px 1px rgba(0,0,0,0.06), 0px 1px 2px rgba(0,0,0,0.04);
      padding: 12px 14px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
    }
    .scraped-row { display: flex; flex-direction: column; gap: 2px; }
    .scraped-row.full { grid-column: 1 / -1; }
    .scraped-label { font-size: 10px; font-weight: 500; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.04em; }
    .scraped-value { font-size: 13px; color: #374151; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .scraped-value.empty { color: #d1d5db; font-style: italic; }

    /* ─── Buttons ────────────────────────────────────────────────────────────── */
    .btn {
      width: 100%; padding: 10px; border: none; border-radius: 8px;
      font-size: 14px; font-family: inherit; font-weight: 500; cursor: pointer;
      transition-property: opacity, transform; transition-duration: 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:active { transform: scale(0.96); }
    .btn:disabled { opacity: 0.4; cursor: default; transform: none; }
    .btn--primary      { background: #111;     color: #fff; margin-top: 8px; }
    .btn--scan         { background: #2563eb;  color: #fff; margin-top: 12px; }
    .btn--save-profile { background: #2563eb;  color: #fff; margin-top: 8px; }
    .btn--release      { background: #16a34a;  color: #fff; padding: 8px 20px; width: auto; }
    .scan-result { font-size: 13px; color: #6b7280; margin-top: 10px; min-height: 18px; }

    /* ─── Bottom bar ─────────────────────────────────────────────────────────── */
    .bottombar {
      height: 56px;
      padding: 0 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fff;
      border-top: 1px solid #e5e7eb;
      flex-shrink: 0;
      gap: 16px;
    }
    .bottombar__left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; overflow: hidden; }
    .bottombar__right { flex-shrink: 0; }

    /* ─── Consumer status chips ──────────────────────────────────────────────── */
    .status-chips { display: flex; gap: 6px; flex-shrink: 0; }
    .status-chip {
      display: flex; align-items: center; gap: 5px;
      font-size: 12px; font-weight: 500; color: #374151;
      background: #f9fafb; border: 1px solid #e5e7eb;
      border-radius: 20px; padding: 3px 8px; white-space: nowrap;
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.clean   { background: #16a34a; }
    .status-dot.dirty   { background: #f59e0b; }
    .status-dot.loading { background: #d1d5db; }

    .btn--check {
      font-size: 12px; font-family: inherit; font-weight: 500;
      color: #6b7280; background: none; border: 1px solid #e5e7eb;
      border-radius: 6px; padding: 5px 10px; cursor: pointer; flex-shrink: 0;
      transition-property: border-color, color; transition-duration: 0.15s;
    }
    .btn--check:hover { border-color: #9ca3af; color: #374151; }
    .btn--check:active { transform: scale(0.96); }

    /* ─── Release panel ──────────────────────────────────────────────────────── */
    .release-panel {
      background: #0f172a;
      border-top: 1px solid #1e293b;
      padding: 14px 24px;
      flex-shrink: 0;
      max-height: 200px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 12px;
      line-height: 1.7;
    }
    .log-line       { color: #94a3b8; }
    .log-line.ok    { color: #4ade80; }
    .log-line.err   { color: #f87171; }
    .log-line.done  { color: #fff; font-weight: bold; }

    /* ─── Toast ──────────────────────────────────────────────────────────────── */
    .toast {
      position: fixed;
      bottom: 72px; left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #111; color: #fff;
      padding: 10px 20px; border-radius: 8px; font-size: 14px;
      opacity: 0; pointer-events: none; z-index: 500;
      transition-property: opacity, transform; transition-duration: 0.2s;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  </style>
</head>
<body>

<header class="topbar">
  <span class="topbar__title">Klub editor</span>
  <span class="version-badge" id="version-badge">v…</span>
</header>

<main class="page-content">
  <div class="content-col">

    <div class="card">
      <span class="card-title">Klub</span>
      <div class="ac-wrap">
        <input type="text" id="search" placeholder="Søg efter klub…" autocomplete="off">
        <div class="ac-dropdown" id="dropdown"></div>
      </div>
    </div>

    <div class="empty-state" id="no-club-state">
      <p>Vælg en klub for at redigere</p>
    </div>

    <div id="club-section" hidden>

      <div class="card-row">

        <div class="card">
          <span class="card-title">Kit</span>

          <div class="field">
            <div class="preview">
              <div class="preview-col">
                <img class="preview-avatar" id="preview-fallback" src="" alt="">
                <span class="preview-col-label">Fallback</span>
              </div>
              <div class="preview-col">
                <img class="preview-avatar" id="preview-logo" src="" alt="" style="display:none">
                <div class="no-logo-placeholder" id="no-logo-placeholder">⌀</div>
                <span class="preview-col-label">Logo</span>
              </div>
              <div class="preview-col">
                <div id="preview-shirt"></div>
                <span class="preview-col-label">Dragt</span>
              </div>
            </div>
          </div>

          <div class="field">
            <label>Forkortelse (fallback-avatar)</label>
            <input type="text" id="abbreviation" maxlength="3" placeholder="Auto-genereret" autocomplete="off">
          </div>

          <div class="field">
            <label>Farver</label>
            <div class="colors-row">
              <div class="color-field">
                <div class="color-input-wrap">
                  <input type="color" id="primary-color" value="#222222">
                  <input type="text" class="color-hex" id="primary-hex" value="#222222" maxlength="7" spellcheck="false">
                </div>
              </div>
              <div class="color-field">
                <div class="color-input-wrap">
                  <input type="color" id="secondary-color" value="#ffffff">
                  <input type="text" class="color-hex" id="secondary-hex" value="#ffffff" maxlength="7" spellcheck="false">
                </div>
              </div>
            </div>
          </div>

          <div class="field">
            <label>Mønster</label>
            <div class="seg-ctrl" id="kit-style">
              <button class="seg-btn active" data-value="plain">Ingen</button>
              <button class="seg-btn" data-value="stripes-v">Lodrette</button>
              <button class="seg-btn" data-value="stripes-h">Vandrette</button>
            </div>
          </div>

          <button class="btn btn--primary" id="save-btn">Gem kit</button>
        </div>

        <div class="card">
          <div class="card-title-row">
            <span class="card-title">Klubprofil — findenklub</span>
            <button class="profil-toggle-btn" id="profil-toggle-btn" type="button">Vis alle felter</button>
          </div>

          <div class="field">
            <label>Indmeldelse</label>
            <input type="text" id="indmeldelses-url" placeholder="https://…">
          </div>

          <div class="field">
            <label>Venteliste</label>
            <input type="text" id="venteliste-url" placeholder="https://…">
          </div>

          <div class="profil-advanced" hidden>
            <div class="field">
              <label>Prøvetræning</label>
              <input type="text" id="proevetraening-url" placeholder="https://…">
            </div>

            <div class="field">
              <label>Kontaktpunkt</label>
              <input type="text" id="profil-kontaktpunkt" placeholder="Fx: Mail til U11-træneren eller ring til kontoret">
            </div>

            <div class="field">
              <label>Indmeldelseslink (CTA-knap)</label>
              <input type="text" id="profil-signup-url" placeholder="https://…">
            </div>

            <div class="field">
              <label>Kontingent (standard)</label>
              <div class="currency-wrap">
                <input type="number" id="profil-kontingent" min="0" step="1" placeholder="0">
                <span class="currency-suffix">kr.</span>
              </div>
            </div>

            <div class="field">
              <label>Indmeldelsesgebyr</label>
              <div class="currency-wrap">
                <input type="number" id="profil-indmeldelses-gebyr" min="0" step="1" placeholder="0">
                <span class="currency-suffix">kr.</span>
              </div>
            </div>

            <div class="field">
              <label>Ventelistegebyr</label>
              <div class="currency-wrap">
                <input type="number" id="profil-venteliste-gebyr" min="0" step="1" placeholder="0">
                <span class="currency-suffix">kr.</span>
              </div>
            </div>

            <hr class="profil-divider">

            <div id="team-profil-rows">
              <p class="team-vl-empty">Ingen hold tilknyttet denne klub.</p>
            </div>
          </div>

          <button class="btn btn--save-profile" id="save-profil-btn">Gem profil →</button>
        </div>

      </div>

      <div class="card">
        <span class="card-title">Klub-data</span>
        <div class="scraped-info" id="scraped-info">
          <div class="scraped-row">
            <span class="scraped-label">By</span>
            <span class="scraped-value" id="si-city">—</span>
          </div>
          <div class="scraped-row">
            <span class="scraped-label">Postnr.</span>
            <span class="scraped-value" id="si-postal">—</span>
          </div>
          <div class="scraped-row">
            <span class="scraped-label">Region</span>
            <span class="scraped-value" id="si-region">—</span>
          </div>
          <div class="scraped-row">
            <span class="scraped-label">Telefon</span>
            <span class="scraped-value" id="si-phone">—</span>
          </div>
          <div class="scraped-row full">
            <span class="scraped-label">Email</span>
            <span class="scraped-value" id="si-email">—</span>
          </div>
          <div class="scraped-row full">
            <span class="scraped-label">Website</span>
            <span class="scraped-value" id="si-website">—</span>
          </div>
        </div>
      </div>

    </div>

    <div class="card">
      <span class="card-title">Logoer</span>
      <button class="btn btn--scan" id="scan-btn">Scan assets/logos/ og opdater clubs.json →</button>
      <p class="scan-result" id="scan-result"></p>
    </div>

  </div>
</main>

<div class="release-panel" id="release-panel" hidden>
  <div id="release-log"></div>
</div>

<footer class="bottombar">
  <div class="bottombar__left">
    <div class="status-chips" id="consumer-status-chips">
      <div class="status-chip"><div class="status-dot loading"></div>Tjekker…</div>
    </div>
    <button class="btn--check" id="check-btn" onclick="checkConsumers()">Tjek igen</button>
  </div>
  <div class="bottombar__right">
    <button class="btn btn--release" id="release-btn">Udgiv ny version →</button>
  </div>
</footer>

<div class="toast" id="toast"></div>

<script>
let clubs = [];
let selectedClub = null;
let primary = '#222222';
let secondary = '#ffffff';
let kitStyle = 'plain';

// ── Version ───────────────────────────────────────────────────────────────────
fetch('/version').then(r => r.text()).then(v => {
  document.getElementById('version-badge').textContent = 'v' + v;
});

// ── Load clubs + teams ────────────────────────────────────────────────────────
let teamsMap = {};
Promise.all([
  fetch('/clubs.json').then(r => r.json()),
  fetch('/teams.json').then(r => r.json()),
]).then(([clubData, teamData]) => {
  teamsMap = teamData;
  clubs = clubData;
  showSuggestions('');
});

// ── Avatar ────────────────────────────────────────────────────────────────────
function autoAbbr(name) {
  return name.replace(/\\(.*?\\)/g, '').trim()
    .split(/\\s+/).filter(w => /[a-zæøå]/i.test(w))
    .map(w => w[0].toUpperCase()).join('').slice(0, 3) || name.slice(0, 2).toUpperCase();
}

function contrastColor(hex) {
  const c = (hex || 'ebebeb').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const toLinear = x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}

function makeFallbackUrl(name, abbreviation, bgColor) {
  const abbr = abbreviation || autoAbbr(name);
  const sz   = abbr.length <= 2 ? 42 : 36;
  const bg   = bgColor || '#ebebeb';
  const fg   = contrastColor(bg);
  const svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="\${bg}"/><text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="DM Sans,sans-serif" font-weight="600" font-size="\${sz}" fill="\${fg}">\${abbr}</text></svg>\`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function updateAvatars(name, logo, abbreviation) {
  const fallbackEl       = document.getElementById('preview-fallback');
  const logoEl           = document.getElementById('preview-logo');
  const noLogoEl         = document.getElementById('no-logo-placeholder');
  fallbackEl.src = makeFallbackUrl(name, abbreviation, primary);
  if (logo) {
    logoEl.src = '/' + logo;
    logoEl.style.display = '';
    noLogoEl.style.display = 'none';
  } else {
    logoEl.src = '';
    logoEl.style.display = 'none';
    noLogoEl.style.display = '';
  }
}

// ── Shirt SVG ─────────────────────────────────────────────────────────────────
function shirtSVG(p, s, style) {
  const stripeCount = 5;
  let decoration = '';

  if (style === 'stripes-v') {
    const w = 100 / (stripeCount * 2 - 1);
    for (let i = 0; i < stripeCount; i++) {
      decoration += \`<rect x="\${i * w * 2}%" y="0" width="\${w}%" height="100%" fill="\${s}" opacity="0.6"/>\`;
    }
  } else if (style === 'stripes-h') {
    const h = 100 / (stripeCount * 2 - 1);
    for (let i = 0; i < stripeCount; i++) {
      decoration += \`<rect x="0" y="\${i * h * 2}%" width="100%" height="\${h}%" fill="\${s}" opacity="0.6"/>\`;
    }
  }

  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <clipPath id="shirt-clip">
        <path d="M15,8 L0,28 L18,34 L18,92 L82,92 L82,34 L100,28 L85,8 L68,18 Q50,26 32,18 Z"/>
      </clipPath>
    </defs>
    <path d="M15,8 L0,28 L18,34 L18,92 L82,92 L82,34 L100,28 L85,8 L68,18 Q50,26 32,18 Z" fill="\${p}"/>
    <g clip-path="url(#shirt-clip)">\${decoration}</g>
    <path d="M32,18 Q50,26 68,18 Q60,32 50,32 Q40,32 32,18 Z" fill="\${s}" opacity="0.8"/>
    <path d="M15,8 L0,28 L18,34 L18,92 L82,92 L82,34 L100,28 L85,8 L68,18 Q50,26 32,18 Z" fill="none" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>
  </svg>\`;
}

function updatePreview() {
  document.getElementById('preview-shirt').innerHTML = shirtSVG(primary, secondary, kitStyle);
}

// ── Combobox ──────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search');
const dropdown    = document.getElementById('dropdown');
const clubSection = document.getElementById('club-section');
const noClubState = document.getElementById('no-club-state');
let activeIdx = -1;

function showSuggestions(q) {
  const lower = q.toLowerCase();
  let results;
  if (!lower) {
    results = clubs.slice(0, 8);
  } else {
    const starts   = clubs.filter(c => c.name.toLowerCase().startsWith(lower));
    const contains = clubs.filter(c => !c.name.toLowerCase().startsWith(lower) && c.name.toLowerCase().includes(lower));
    results = [...starts, ...contains].slice(0, 8);
  }
  dropdown.innerHTML = '';
  activeIdx = -1;
  if (!results.length) { dropdown.style.display = 'none'; return; }
  results.forEach(club => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    item.textContent = club.name;
    item.addEventListener('mousedown', e => { e.preventDefault(); selectClub(club); });
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

function selectClub(club) {
  selectedClub = { ...club, teams: teamsMap[club.dbuId]?.teams ?? [] };
  searchInput.value = club.name;
  dropdown.style.display = 'none';
  primary   = club.primaryColor   ?? '#222222';
  secondary = club.secondaryColor ?? '#ffffff';
  kitStyle  = club.kitStyle       ?? 'plain';
  document.getElementById('primary-color').value   = primary;
  document.getElementById('secondary-color').value = secondary;
  document.getElementById('primary-hex').value     = primary;
  document.getElementById('secondary-hex').value   = secondary;
  document.querySelectorAll('#kit-style .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === kitStyle);
  });
  clubSection.hidden = false;
  noClubState.hidden = true;

  function si(id, val) {
    const el = document.getElementById(id);
    el.textContent = val || '—';
    el.classList.toggle('empty', !val);
  }
  si('si-city',    club.city);
  si('si-postal',  club.postal);
  si('si-region',  club.region);
  si('si-phone',   club.phone);
  si('si-email',   club.email);
  si('si-website', club.website);

  const abbrInput = document.getElementById('abbreviation');
  abbrInput.value = club.abbreviation ?? '';
  abbrInput.placeholder = autoAbbr(club.name);
  updateAvatars(club.name, club.logo ?? null, club.abbreviation ?? '');
  updatePreview();
  loadSupabaseProfil(club.dbuId);
}

searchInput.addEventListener('focus', () => showSuggestions(searchInput.value));
searchInput.addEventListener('input', () => {
  selectedClub = null;
  clubSection.hidden = true;
  noClubState.hidden = false;
  showSuggestions(searchInput.value);
});
searchInput.addEventListener('keydown', e => {
  const items = dropdown.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown')      { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, -1); }
  else if (e.key === 'Escape')    { dropdown.style.display = 'none'; return; }
  else return;
  items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
});
document.addEventListener('mousedown', e => {
  if (!e.target.closest('.ac-wrap')) dropdown.style.display = 'none';
});

// ── Color pickers ─────────────────────────────────────────────────────────────
function isValidHex(v) { return /^#[0-9a-fA-F]{6}$/.test(v); }

document.getElementById('primary-color').addEventListener('input', e => {
  primary = e.target.value;
  document.getElementById('primary-hex').value = primary;
  updatePreview(); if (selectedClub) updateAvatars(selectedClub.name, selectedClub.logo ?? null, document.getElementById('abbreviation').value.trim() || null);
});
document.getElementById('primary-hex').addEventListener('input', e => {
  const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
  if (isValidHex(v)) { primary = v; document.getElementById('primary-color').value = v; updatePreview(); if (selectedClub) updateAvatars(selectedClub.name, selectedClub.logo ?? null, document.getElementById('abbreviation').value.trim() || null); }
});
document.getElementById('secondary-color').addEventListener('input', e => {
  secondary = e.target.value;
  document.getElementById('secondary-hex').value = secondary;
  updatePreview(); if (selectedClub) updateAvatars(selectedClub.name, selectedClub.logo ?? null, document.getElementById('abbreviation').value.trim() || null);
});
document.getElementById('secondary-hex').addEventListener('input', e => {
  const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
  if (isValidHex(v)) { secondary = v; document.getElementById('secondary-color').value = v; updatePreview(); if (selectedClub) updateAvatars(selectedClub.name, selectedClub.logo ?? null, document.getElementById('abbreviation').value.trim() || null); }
});

// ── Kit style ─────────────────────────────────────────────────────────────────
document.querySelectorAll('#kit-style .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    kitStyle = btn.dataset.value;
    document.querySelectorAll('#kit-style .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updatePreview();
  });
});

// ── Abbreviation ──────────────────────────────────────────────────────────────
document.getElementById('abbreviation').addEventListener('input', e => {
  if (!selectedClub) return;
  const val = e.target.value.trim().toUpperCase();
  updateAvatars(selectedClub.name, selectedClub.logo ?? null, val);
});

// ── Save ──────────────────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!selectedClub) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Gemmer…';
  const abbreviation = document.getElementById('abbreviation').value.trim().toUpperCase() || null;
  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedClub.name, primaryColor: primary, secondaryColor: secondary, kitStyle, abbreviation }),
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Gemt ✓');
    selectedClub.primaryColor   = primary;
    selectedClub.secondaryColor = secondary;
    selectedClub.kitStyle       = kitStyle;
    selectedClub.abbreviation   = abbreviation;
  } catch (err) {
    showToast('Fejl: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gem';
  }
});

// ── Supabase profil ───────────────────────────────────────────────────────────
const VL_OPTIONS = [
  { value: 'ukendt',      label: 'Ukendt' },
  { value: 'åben',        label: 'Åben' },
  { value: 'lang_ventetid', label: 'Lang ventetid' },
  { value: 'lukket',      label: 'Lukket' },
];

function renderTeamProfilRows(teams, savedVenteliste = {}, savedKontingent = {}, defaultKontingent = null) {
  const container = document.getElementById('team-profil-rows');
  if (!teams?.length) {
    container.innerHTML = '<p class="team-vl-empty">Ingen hold tilknyttet denne klub.</p>';
    return;
  }
  const ktPlaceholder = defaultKontingent != null ? \`\${defaultKontingent} kr.\` : '0';
  container.innerHTML = teams.map(t => {
    const key    = \`\${t.ageGroup} \${t.gender}\`;
    const curVl  = savedVenteliste[key] ?? 'ukendt';
    const curKt  = savedKontingent[key] ?? '';
    const opts   = VL_OPTIONS.map(o =>
      \`<option value="\${o.value}"\${curVl === o.value ? ' selected' : ''}>\${o.label}</option>\`
    ).join('');
    return \`<div class="team-profil-group">
      <span class="team-profil-label">\${key}</span>
      <div class="team-profil-fields">
        <div class="field">
          <label>Kontingent</label>
          <div class="team-kt-wrap">
            <input class="team-kt-input" type="number" min="0" step="1" data-team-key="\${key}"
              value="\${curKt}" placeholder="\${ktPlaceholder}">
            <span class="currency-suffix">kr.</span>
          </div>
        </div>
        <div class="field">
          <label>Ventelistestatus</label>
          <select class="team-vl-select" data-team-key="\${key}">\${opts}</select>
        </div>
      </div>
    </div>\`;
  }).join('');
}

function collectTeamVenteliste() {
  const result = {};
  document.querySelectorAll('.team-vl-select').forEach(sel => {
    if (sel.value !== 'ukendt') result[sel.dataset.teamKey] = sel.value;
  });
  return Object.keys(result).length ? result : null;
}

function collectTeamKontingent() {
  const result = {};
  document.querySelectorAll('.team-kt-input').forEach(inp => {
    const n = parseInt(inp.value, 10);
    if (!isNaN(n) && n >= 0) result[inp.dataset.teamKey] = n;
  });
  return Object.keys(result).length ? result : null;
}

document.getElementById('profil-toggle-btn').addEventListener('click', () => {
  const panel = document.querySelector('.profil-advanced');
  const btn   = document.getElementById('profil-toggle-btn');
  panel.hidden = !panel.hidden;
  btn.textContent = panel.hidden ? 'Vis alle felter' : 'Skjul alle felter';
});

function clearProfilFields() {
  document.getElementById('indmeldelses-url').value  = '';
  document.getElementById('venteliste-url').value    = '';
  document.getElementById('proevetraening-url').value = '';
  document.getElementById('profil-kontaktpunkt').value = '';
  document.getElementById('profil-signup-url').value   = '';
  document.getElementById('profil-kontingent').value   = '';
  document.getElementById('profil-indmeldelses-gebyr').value = '';
  document.getElementById('profil-venteliste-gebyr').value   = '';
  renderTeamProfilRows(selectedClub?.teams ?? []);
}

async function loadSupabaseProfil(dbuId) {
  clearProfilFields();
  if (!dbuId) return;
  try {
    const data = await fetch('/supabase/club?dbuId=' + dbuId).then(r => r.json());
    if (!data) return;
    document.getElementById('indmeldelses-url').value   = data.indmeldelses_url ?? '';
    document.getElementById('venteliste-url').value     = data.venteliste_url ?? '';
    document.getElementById('proevetraening-url').value = data.proevetraening_url ?? '';
    document.getElementById('profil-kontaktpunkt').value = data.kontaktpunkt ?? '';
    document.getElementById('profil-signup-url').value   = data.signup_url ?? '';
    document.getElementById('profil-kontingent').value   = data.kontingent ?? '';
    document.getElementById('profil-indmeldelses-gebyr').value = data.indmeldelses_gebyr ?? '';
    document.getElementById('profil-venteliste-gebyr').value   = data.venteliste_gebyr ?? '';
    renderTeamProfilRows(selectedClub?.teams ?? [], data.team_venteliste ?? {}, data.team_kontingent ?? {}, data.kontingent ?? null);
  } catch { /* leave fields cleared */ }
}

document.getElementById('save-profil-btn').addEventListener('click', async () => {
  if (!selectedClub?.dbuId) return;
  const btn = document.getElementById('save-profil-btn');
  btn.disabled = true;
  btn.textContent = 'Gemmer…';
  try {
    const res = await fetch('/supabase/club', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dbuId:            selectedClub.dbuId,
        clubName:         selectedClub.name,
        teamVenteliste:   collectTeamVenteliste(),
        teamKontingent:   collectTeamKontingent(),
        indmeldelsesUrl:  document.getElementById('indmeldelses-url').value.trim() || null,
        ventelisteUrl:    document.getElementById('venteliste-url').value.trim() || null,
        proevetræningUrl: document.getElementById('proevetraening-url').value.trim() || null,
        kontaktpunkt:     document.getElementById('profil-kontaktpunkt').value.trim() || null,
        signupUrl:           document.getElementById('profil-signup-url').value.trim() || null,
        kontingent:          parseInt(document.getElementById('profil-kontingent').value, 10) || null,
        indmeldelsesGebyr:   parseInt(document.getElementById('profil-indmeldelses-gebyr').value, 10) || null,
        ventelisteGebyr:     parseInt(document.getElementById('profil-venteliste-gebyr').value, 10) || null,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Profil gemt ✓');
  } catch (err) {
    showToast('Fejl: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gem profil →';
  }
});

// ── Scan logos ────────────────────────────────────────────────────────────────
document.getElementById('scan-btn').addEventListener('click', async () => {
  const btn = document.getElementById('scan-btn');
  const result = document.getElementById('scan-result');
  btn.disabled = true;
  result.textContent = 'Scanner…';
  try {
    const res = await fetch('/scan-logos', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    const { updated, skipped } = await res.json();
    if (updated.length) {
      result.textContent = \`Opdateret: \${updated.join(', ')}\`;
      // Refresh local clubs list so the editor reflects new logos
      clubs = await fetch('/clubs.json').then(r => r.json());
    } else {
      result.textContent = skipped.length
        ? \`Ingen nye logoer. \${skipped.length} fil(er) matchede ingen klub.\`
        : 'Ingen nye logoer at tilknytte.';
    }
  } catch (err) {
    result.textContent = 'Fejl: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ── Release ───────────────────────────────────────────────────────────────────
document.getElementById('release-btn').addEventListener('click', async () => {
  const btn   = document.getElementById('release-btn');
  const panel = document.getElementById('release-panel');
  const log   = document.getElementById('release-log');

  try {
    const results = await fetch('/consumer-status').then(r => r.json());
    const dirty = results.filter(r => !r.clean);
    if (dirty.length) {
      const names = dirty.map(r => r.label).join(', ');
      const ok = confirm(\`\${names} har ugemte ændringer. Vil du udgive alligevel?\`);
      if (!ok) return;
    }
  } catch { /* network error — proceed anyway */ }

  btn.disabled = true;
  panel.hidden = false;
  log.innerHTML = '';

  function addLine(text, cls = '') {
    const line = document.createElement('div');
    line.className = 'log-line' + (cls ? ' ' + cls : '');
    line.textContent = text;
    log.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }

  const es = new EventSource('/release');
  es.addEventListener('log',  e => addLine(e.data));
  es.addEventListener('ok',   e => addLine(e.data, 'ok'));
  es.addEventListener('err',  e => { addLine(e.data, 'err'); es.close(); btn.disabled = false; });
  es.addEventListener('done', e => {
    addLine(e.data, 'done');
    es.close();
    btn.disabled = false;
    fetch('/version').then(r => r.text()).then(v => {
      document.getElementById('version-badge').textContent = 'v' + v;
    });
  });
});

// ── Consumer status ───────────────────────────────────────────────────────────
async function checkConsumers() {
  const chips = document.getElementById('consumer-status-chips');
  chips.innerHTML = \`<div class="status-chip"><div class="status-dot loading"></div>Tjekker…</div>\`;
  try {
    const results = await fetch('/consumer-status').then(r => r.json());
    chips.innerHTML = results.map(({ label, clean }) => \`
      <div class="status-chip">
        <div class="status-dot \${clean ? 'clean' : 'dirty'}"></div>
        \${label}
      </div>
    \`).join('');
  } catch {
    chips.innerHTML = \`<div class="status-chip"><div class="status-dot dirty"></div>Fejl</div>\`;
  }
}

checkConsumers();

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
</script>
</body>
</html>`;

// ─── SSE helper ───────────────────────────────────────────────────────────────
function sseRun(res, steps) {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const send = (type, data) => res.write(`event: ${type}\ndata: ${data}\n\n`);

  (async () => {
    for (const { label, cmd, cwd } of steps) {
      send('log', `→ ${label}`);
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn('sh', ['-c', cmd], { cwd: cwd ?? __dirname + '/..' });
          proc.stdout.on('data', d => d.toString().trim().split('\n').forEach(l => l && send('log', `  ${l}`)));
          proc.stderr.on('data', d => d.toString().trim().split('\n').forEach(l => l && send('log', `  ${l}`)));
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
        });
        send('ok', `✓ ${label}`);
      } catch (err) {
        send('err', `✗ ${label}: ${err.message}`);
        res.end();
        return;
      }
    }
    send('done', `Udgivet som v${getVersion()} ✓`);
    res.end();
  })();
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && req.url === '/clubs.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fs.readFileSync(CLUBS_PATH));
    return;
  }

  if (req.method === 'GET' && req.url === '/teams.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fs.existsSync(TEAMS_PATH) ? fs.readFileSync(TEAMS_PATH) : '{}');
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/assets/')) {
    const filePath = path.resolve(__dirname, '..', decodeURIComponent(req.url.slice(1)));
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404); res.end();
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/version') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(getVersion());
    return;
  }

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, primaryColor, secondaryColor, kitStyle, abbreviation } = JSON.parse(body);
        const clubs = JSON.parse(fs.readFileSync(CLUBS_PATH, 'utf8'));
        const club = clubs.find(c => c.name === name);
        if (!club) { res.writeHead(404); res.end('Club not found'); return; }
        club.primaryColor   = primaryColor;
        club.secondaryColor = secondaryColor;
        club.kitStyle       = kitStyle;
        if (abbreviation) club.abbreviation = abbreviation;
        else delete club.abbreviation;
        fs.writeFileSync(CLUBS_PATH, JSON.stringify(clubs, null, 2));
        res.writeHead(200);
        res.end('ok');
        console.log(`Saved: ${name} — ${primaryColor} / ${secondaryColor} / ${kitStyle}${abbreviation ? ' / ' + abbreviation : ''}`);
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/scan-logos') {
    try {
      const clubs    = JSON.parse(fs.readFileSync(CLUBS_PATH, 'utf8'));
      const logosDir = path.resolve(__dirname, '../assets/logos');
      const files    = fs.existsSync(logosDir) ? fs.readdirSync(logosDir) : [];
      const updated  = [];
      const skipped  = [];

      for (const file of files) {
        const dbuId = parseInt(path.basename(file, path.extname(file)), 10);
        if (!dbuId) { skipped.push(file); continue; }
        const club = clubs.find(c => c.dbuId === dbuId);
        if (!club) { skipped.push(file); continue; }
        const logoPath = `assets/logos/${file}`;
        if (club.logo === logoPath) continue; // already set
        club.logo = logoPath;
        updated.push(club.name);
      }

      if (updated.length) fs.writeFileSync(CLUBS_PATH, JSON.stringify(clubs, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ updated, skipped }));
      if (updated.length) console.log('Logos linked:', updated.join(', '));
    } catch (err) {
      res.writeHead(500); res.end(err.message);
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/consumer-status') {
    const consumers = [{ label: 'Opstillingen', path: OPSTILLINGEN_PATH }];
    if (fs.existsSync(FINDENKLUB_PATH)) consumers.push({ label: 'findenklub', path: FINDENKLUB_PATH });

    const results = consumers.map(({ label, path: repoPath }) => {
      try {
        const staged = execSync('git diff --cached --stat', { cwd: repoPath, encoding: 'utf8' }).trim();
        return { label, clean: !staged, detail: staged || null };
      } catch (e) {
        return { label, clean: false, detail: 'Fejl: ' + e.message };
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
    return;
  }

  if (req.method === 'GET' && req.url === '/release') {
    const ROOT = path.resolve(__dirname, '..');

    const steps = [
      {
        label: 'Gem ændringer i klub-data og logoer',
        cmd:   'git add clubs.json assets/logos/ 2>/dev/null; git diff --cached --quiet && echo "ingen ændringer" || git commit -m "Update club data"',
        cwd:   ROOT,
      },
      {
        label: 'Byg genererede filer',
        cmd:   'node scripts/buildIndex.js && ([ -f bydel.json ] && node scripts/buildBydel.js || true) && ([ -f municipalities.json ] && node scripts/buildMunicipalities.js || true) && ([ -f teams.json ] || [ -f teams-national.json ]) && node scripts/buildTeams.js || true',
        cwd:   ROOT,
      },
      {
        label: 'Bump version i package.json',
        cmd:   'npm version patch --no-git-tag-version',
        cwd:   ROOT,
      },
      {
        label: 'Commit og tag ny version',
        cmd:   'VERSION=$(node -p "require(\'./package.json\').version") && git add package.json index.js bydel.js municipalities.js municipalities.json postal-municipalities.json teams.js && git commit -m "v$VERSION" && git tag "v$VERSION"',
        cwd:   ROOT,
      },
      {
        label: 'Push danish-football-clubs til GitHub',
        cmd:   'VERSION=$(node -p "require(\'./package.json\').version") && git push origin main && git push origin "v$VERSION"',
        cwd:   ROOT,
      },
      {
        label: 'Opdater CDN-version i opstillingen',
        cmd:   `node -e "const fs=require('fs'),v=require('${PKG_PATH}').version,f='${COMBOBOX_PATH}';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/danish-football-clubs@v[\\d.]+/,'danish-football-clubs@v'+v));console.log('CDN bumped to v'+v)"`,
        cwd:   ROOT,
      },
      {
        label: 'Commit og push opstillingen',
        cmd:   `VERSION=$(node -e "process.stdout.write(require('${PKG_PATH}').version)") && git add src/utils/klub-combobox.js && git commit -m "Bump danish-football-clubs to v$VERSION" && git push origin main`,
        cwd:   OPSTILLINGEN_PATH,
      },
    ];

    // Add findenklub consumer steps once its CDN config file is set above.
    if (FINDENKLUB_APP_PATH && fs.existsSync(FINDENKLUB_APP_PATH)) {
      steps.push(
        {
          label: 'Opdater CDN-version i findenklub',
          cmd:   `node -e "const fs=require('fs'),v=require('${PKG_PATH}').version,f='${FINDENKLUB_APP_PATH}';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/danish-football-clubs@v[\\d.]+/,'danish-football-clubs@v'+v));console.log('CDN bumped to v'+v)"`,
          cwd:   ROOT,
        },
        {
          label: 'Commit og push findenklub',
          cmd:   `VERSION=$(node -e "process.stdout.write(require('${PKG_PATH}').version)") && git add -u && git commit -m "Bump danish-football-clubs to v$VERSION" && git push origin main`,
          cwd:   FINDENKLUB_PATH,
        }
      );
    }

    sseRun(res, steps);
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/supabase/club')) {
    const dbuId = new URL(req.url, 'http://localhost').searchParams.get('dbuId');
    if (!dbuId || !SUPABASE_SERVICE_KEY) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('null');
      return;
    }
    (async () => {
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/clubs_enriched?dbu_id=eq.${dbuId}&select=*&limit=1`,
          { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
        );
        const data = await r.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data[0] ?? null));
      } catch (err) { res.writeHead(500); res.end(err.message); }
    })();
    return;
  }

  if (req.method === 'POST' && req.url === '/supabase/club') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      if (!SUPABASE_SERVICE_KEY) { res.writeHead(500); res.end('Ingen Supabase-nøgle konfigureret'); return; }
      try {
        const { dbuId, clubName, teamVenteliste, teamKontingent, indmeldelsesUrl, ventelisteUrl, proevetræningUrl, kontaktpunkt, signupUrl, kontingent, indmeldelsesGebyr, ventelisteGebyr } = JSON.parse(body);
        const r = await fetch(`${SUPABASE_URL}/rest/v1/clubs_enriched`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            dbu_id:           String(dbuId),
            club_name:        clubName,
            team_venteliste:  teamVenteliste,
            team_kontingent:  teamKontingent,
            indmeldelses_url:   indmeldelsesUrl,
            venteliste_url:     ventelisteUrl,
            proevetraening_url: proevetræningUrl,
            kontaktpunkt,
            signup_url:          signupUrl,
            kontingent,
            indmeldelses_gebyr:  indmeldelsesGebyr,
            venteliste_gebyr:    ventelisteGebyr,
            updated_at:          new Date().toISOString(),
          }),
        });
        if (!r.ok) { const msg = await r.text(); res.writeHead(500); res.end(msg); return; }
        res.writeHead(200); res.end('ok');
        console.log(`Profil gemt: [${dbuId}] ${clubName}`);
      } catch (err) { res.writeHead(500); res.end(err.message); }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\nKlub editor → ${url}\n`);
  exec(`open ${url}`);
});
