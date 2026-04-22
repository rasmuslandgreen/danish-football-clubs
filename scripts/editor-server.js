// ─── Club data editor — local dev tool ────────────────────────────────────────
// Usage: npm run editor
// Opens a browser UI for editing primaryColor, secondaryColor and kitStyle
// for any club in clubs.json. Writes changes directly to the file.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLUBS_PATH = path.resolve(__dirname, '../clubs.json');
const PORT = 3737;

const HTML = /* html */`<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Klub editor</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'DM Sans', sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 48px 16px;
    }

    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 1px 8px rgba(0,0,0,0.06);
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 24px;
      color: #111;
    }

    .field { margin-bottom: 20px; }

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
      transition: border-color 0.15s;
    }
    input[type="text"]:focus { border-color: #111; }

    /* Autocomplete dropdown */
    .ac-wrap { position: relative; }
    .ac-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0; right: 0;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.10);
      z-index: 100;
      max-height: 240px;
      overflow-y: auto;
      display: none;
    }
    .ac-item {
      padding: 9px 12px;
      font-size: 14px;
      cursor: pointer;
      color: #111;
    }
    .ac-item:hover, .ac-item.active { background: #f3f4f6; }

    /* Color pickers */
    .colors-row {
      display: flex;
      gap: 16px;
    }
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
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 50%;
      padding: 0;
      cursor: pointer;
      background: none;
      flex-shrink: 0;
    }
    .color-hex {
      font-size: 13px;
      color: #374151;
      font-family: monospace;
      border: none;
      outline: none;
      width: 72px;
      background: transparent;
      padding: 0;
    }

    /* Segmented control */
    .seg-ctrl {
      display: flex;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .seg-btn {
      flex: 1;
      padding: 8px 4px;
      font-size: 12px;
      font-family: inherit;
      font-weight: 500;
      background: none;
      border: none;
      border-right: 1px solid #e5e7eb;
      cursor: pointer;
      color: #6b7280;
      transition: background 0.1s, color 0.1s;
    }
    .seg-btn:last-child { border-right: none; }
    .seg-btn.active { background: #111; color: #fff; }

    /* Shirt preview */
    .preview {
      display: flex;
      justify-content: center;
      padding: 16px 0 8px;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: #111;
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

    /* Save button */
    .save-btn {
      width: 100%;
      padding: 10px;
      background: #111;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.15s;
    }
    .save-btn:hover { opacity: 0.85; }
    .save-btn:disabled { opacity: 0.4; cursor: default; }

    .no-club { color: #9ca3af; font-size: 13px; margin-top: 16px; text-align: center; }
  </style>
</head>
<body>
<div class="card">
  <h1>Klub editor</h1>

  <div class="field">
    <label>Klub</label>
    <div class="ac-wrap">
      <input type="text" id="search" placeholder="Søg efter klub…" autocomplete="off">
      <div class="ac-dropdown" id="dropdown"></div>
    </div>
  </div>

  <div id="editor" hidden>
    <div class="field">
      <div class="preview" id="preview"></div>
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

    <button class="save-btn" id="save-btn">Gem</button>
  </div>

  <p class="no-club" id="no-club" hidden>Vælg en klub for at redigere</p>
</div>

<div class="toast" id="toast"></div>

<script>
let clubs = [];
let selectedClub = null;
let primary = '#222222';
let secondary = '#ffffff';
let kitStyle = 'plain';

// ── Load clubs ────────────────────────────────────────────────────────────────
fetch('/clubs.json').then(r => r.json()).then(data => {
  clubs = data;
  showSuggestions('');
});

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
  document.getElementById('preview').innerHTML = shirtSVG(primary, secondary, kitStyle);
}

// ── Combobox ──────────────────────────────────────────────────────────────────
const searchInput = document.getElementById('search');
const dropdown = document.getElementById('dropdown');
const editor = document.getElementById('editor');
const noClub = document.getElementById('no-club');
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

  results.forEach((club, i) => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    item.textContent = club.name;
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      selectClub(club);
    });
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

function selectClub(club) {
  selectedClub = club;
  searchInput.value = club.name;
  dropdown.style.display = 'none';

  primary   = club.primaryColor   ?? '#222222';
  secondary = club.secondaryColor ?? '#ffffff';
  kitStyle  = club.kitStyle       ?? 'plain';

  document.getElementById('primary-color').value   = primary;
  document.getElementById('secondary-color').value = secondary;
  document.getElementById('primary-hex').value   = primary;
  document.getElementById('secondary-hex').value = secondary;

  document.querySelectorAll('#kit-style .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === kitStyle);
  });

  editor.hidden = false;
  noClub.hidden = true;
  updatePreview();
}

searchInput.addEventListener('focus', () => showSuggestions(searchInput.value));
searchInput.addEventListener('input', () => {
  selectedClub = null;
  editor.hidden = true;
  noClub.hidden = false;
  showSuggestions(searchInput.value);
});

searchInput.addEventListener('keydown', e => {
  const items = dropdown.querySelectorAll('.ac-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIdx = Math.min(activeIdx + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = Math.max(activeIdx - 1, -1);
  } else if (e.key === 'Escape') {
    dropdown.style.display = 'none';
    return;
  } else return;
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
  updatePreview();
});
document.getElementById('primary-hex').addEventListener('input', e => {
  const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
  if (isValidHex(v)) {
    primary = v;
    document.getElementById('primary-color').value = v;
    updatePreview();
  }
});

document.getElementById('secondary-color').addEventListener('input', e => {
  secondary = e.target.value;
  document.getElementById('secondary-hex').value = secondary;
  updatePreview();
});
document.getElementById('secondary-hex').addEventListener('input', e => {
  const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value;
  if (isValidHex(v)) {
    secondary = v;
    document.getElementById('secondary-color').value = v;
    updatePreview();
  }
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

// ── Save ──────────────────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  if (!selectedClub) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Gemmer…';

  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: selectedClub.name, primaryColor: primary, secondaryColor: secondary, kitStyle }),
    });
    if (!res.ok) throw new Error(await res.text());
    showToast('Gemt ✓');
    // Update local cache
    selectedClub.primaryColor   = primary;
    selectedClub.secondaryColor = secondary;
    selectedClub.kitStyle       = kitStyle;
  } catch (err) {
    showToast('Fejl: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gem';
  }
});

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
</script>
</body>
</html>`;

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

  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { name, primaryColor, secondaryColor, kitStyle } = JSON.parse(body);
        const clubs = JSON.parse(fs.readFileSync(CLUBS_PATH, 'utf8'));
        const club = clubs.find(c => c.name === name);
        if (!club) { res.writeHead(404); res.end('Club not found'); return; }
        club.primaryColor   = primaryColor;
        club.secondaryColor = secondaryColor;
        club.kitStyle       = kitStyle;
        fs.writeFileSync(CLUBS_PATH, JSON.stringify(clubs, null, 2));
        res.writeHead(200);
        res.end('ok');
        console.log(`Saved: ${name} — ${primaryColor} / ${secondaryColor} / ${kitStyle}`);
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
      }
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
