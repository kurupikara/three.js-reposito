# DARI BIJI — 60 detik, canvas 2D × three.js

Film animasi **pohon tumbuh dari biji sampai besar** (tepat 60 detik, 24 fps,
1440 frame, 1920×1080). Dua engine disatukan dalam satu film:

| Bagian | Dari mana | Untuk apa |
|---|---|---|
| Dunia gambar tangan | skill [`hand-drawn-canvas-animation`](https://github.com/alesha-pro/tools/tree/main/skills%2Fhand-drawn-canvas-animation) (core.js, studio.js, render.mjs) | kertas, tanah, hujan, salju, burung, matahari, akar, tunas tinta, huruf judul, kartu penutup, skor Web Audio |
| Pohon hidup 3D | repo **three.js** ini (`build/three.module.js` → `vendor/three.iife.js`) | pohon prosedural yang tumbuh: batang, dahan, daun, musim, goyangan angin — gaya *paper diorama* (toon + garis tinta) |

Alur cerita: biji jatuh → retak → akar digambar ke dalam tanah → tunas tinta
tumbuh → **THE LIFT**: garis konstruksi, tunas tinta "terangkat" dari halaman
menjadi pohon 3D → pohon tumbuh besar (daun muncul, musim gugur, malam salju,
semi mekar) → kartu penutup: pohon tinta + judul **DARI BIJI**.

## Cara membuka (pemutar di browser)

Buka `dari-biji.html` langsung (double-click / drag ke browser):

- **play / pause** + scrub timeline + **export PNG frames** + **export score.wav**
- `dari-biji.html?frame=505` — satu frame (mis. detik ke-20, momen LIFT)
- `dari-biji.html?grid=24` — contact sheet 24 frame sebaran
- `dari-biji.html?bare=1&frame=1200` — kanvas polos tanpa pemutar

Semua asset lokal — bisa dibuka offline lewat `file://` (three.js sudah dibundel
jadi `vendor/three.iife.js`).

## Cara render MP4 (sekali jalan, ±3–5 menit)

Prasyarat: Node ≥ 22, Chrome/Chromium di PATH (atau `CHROME=/path/to/chrome`), `ffmpeg` di PATH.

```bash
npm i --no-audit --no-fund          # puppeteer-core
node render.mjs dari-biji.html      # full render
```

Hasil di `out/`:

- `dari-biji.mp4` — video 60 s H.264 1920×1080 (jejak frame JPEG)
- `dari-biji-final.mp4` — video + skor piano Web Audio (AAC) ← **ini file utama**
- `dari-biji-contact.jpg` — contact sheet 2 tile/detik
- `dari-biji-score.wav` — skor terpisah
- `dari-biji-render.json` — dimensi, frame, durasi (verifikasi)

Mode QA: `--grid 24`, `--strip 48,12`, `--only 48,505,1200` (lihat
`SKILL.md` di repo skill untuk detail).

## Catatan adaptasi teknis (dokumentasi)

1. `vendor/three.iife.js` = `build/three.module.js` + `three.core.js` dari repo
   ini, dibundel IIFE (`npx esbuild ../build/three.module.js --bundle --format=iife --global-name=THREE`)
   supaya jalan dari `file://` tanpa server.
2. `render.mjs` ditambah flag headless `--use-gl=angle --use-angle=swiftshader
   --enable-unsafe-swiftshader` agar WebGL jalan di Chrome headless (software GL).
3. Film memanggil `getContext('2d', { willReadFrequently: true })` sebelum
   `defineFilm` — kanvas 2D backend GPU di software-GL Chromium membuat export
   frame berbiaya detik; backend CPU menurunkannya ke ~0,1 dtk/frame.
4. `tree3d.js` membaca piksel WebGL via `readPixels` ke kanvas scratch CPU
   (bukan `drawImage` langsung dari kanvas WebGL yang "meracuni" kanvas film).
5. `window.__frame` di-override menghasilkan JPEG q0.93 (encoder PNG software
   sangat lambat untuk tekstur berbintik); ffmpeg memprobe isi bytetnya.

## Struktur

```
tree-growth-film/
  dari-biji.html     film: beat sheet, palet, adegan, skor, defineFilm
  tree3d.js          pohon 3D three.js (kerangka prosedural, daun instans, toon+ink)
  core.js            engine skill (disalin apa adanya)
  studio.js          exposure track + stroke engine skill (disalin apa adanya)
  cels.js            (opsional, disalin)
  vendor/three.iife.js   three.js dari repo ini
  render.mjs         pipeline render skill (disalin + flag WebGL)
  package.json       dependensi renderer
  out/               hasil render (mp4, contact, score, json)
```
