# Gallery Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static gallery page on GitHub Pages that shows every committed background as a lightweight thumbnail and lets you download or copy a link to the full-size JPEG.

**Architecture:** A build script reads the JPEGs already committed at the repo root, writes a 640px WebP thumbnail per image into `thumbs/`, and emits `gallery.json` describing them. A single self-contained `index.html` fetches that manifest and renders a responsive grid. Ordering rules are split into a pure, testable module; the script itself only does filesystem and sharp work. GitHub Pages serves `main` at its root, so no CI and no file moves.

**Tech Stack:** Node 22 (`node --test`, built in — no test dependency), sharp 0.35 (already a dependency), vanilla HTML/CSS/JS with no framework and no build step for the page itself.

**Spec:** [docs/superpowers/specs/2026-08-08-gallery-page-design.md](../specs/2026-08-08-gallery-page-design.md)

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `scripts/gallery-manifest.mjs` | **Create.** Pure functions only: thumbnail path derivation and the sort rule. No filesystem access, so the subtle ordering rule is directly testable. |
| `scripts/build-gallery.mjs` | **Create.** All the IO: scans root JPEGs, encodes thumbnails via sharp, writes `gallery.json`. Exports `buildGallery()` so tests can drive it against a temp directory; runs as a CLI when invoked directly. |
| `tests/gallery-manifest.test.mjs` | **Create.** Unit tests for the pure helpers. |
| `tests/build-gallery.test.mjs` | **Create.** Integration tests against a temp fixture directory. |
| `index.html` | **Create.** The gallery page. Self-contained: inline CSS, inline JS, no dependencies. |
| `.nojekyll` | **Create.** Empty file; disables Jekyll processing on Pages. |
| `package.json` | **Modify.** Add the `gallery` and `test` scripts. |
| `thumbs/*.webp` | **Generated + committed.** Produced by Task 3. |
| `gallery.json` | **Generated + committed.** Produced by Task 3. |

**A deliberate duplication:** `build-gallery.mjs` gets its own small `isUpToDate()` helper rather than sharing one with `scripts/convert-raw.mjs`. The two scripts are meant to be read independently, and the helper is eight lines. Do not refactor `convert-raw.mjs` as part of this work.

---

### Task 1: Pure manifest helpers

The sort rule is the one genuinely non-obvious piece of logic in this build, so it goes in a module with no IO and gets tested directly.

**Files:**
- Create: `scripts/gallery-manifest.mjs`
- Create: `tests/gallery-manifest.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add the test script to `package.json`**

Change the `scripts` block so it reads:

```json
  "scripts": {
    "convert": "node scripts/convert-raw.mjs",
    "gallery": "node scripts/build-gallery.mjs",
    "test": "node --test tests/"
  },
```

Both new entries go in now so later tasks do not have to touch this file again. `npm run gallery` will fail until Task 2 creates the script — that is expected.

- [ ] **Step 2: Write the failing test**

Create `tests/gallery-manifest.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbPathFor, sortGalleryNames } from '../scripts/gallery-manifest.mjs';

test('thumbPathFor swaps the extension and moves the file into thumbs/', () => {
  assert.equal(
    thumbPathFor('2026-08-07-commute-nostromo-corridors.jpg'),
    'thumbs/2026-08-07-commute-nostromo-corridors.webp',
  );
});

test('thumbPathFor only replaces the final extension', () => {
  assert.equal(thumbPathFor('a.b.c.jpg'), 'thumbs/a.b.c.webp');
});

test('sortGalleryNames puts the newest daily first', () => {
  const sorted = sortGalleryNames([
    '2026-08-06-trade-view-ganymede-agri-dome-jawas.jpg',
    '2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg',
    '2026-08-07-commute-nostromo-corridors.jpg',
  ]);
  assert.deepEqual(sorted, [
    '2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg',
    '2026-08-07-commute-nostromo-corridors.jpg',
    '2026-08-06-trade-view-ganymede-agri-dome-jawas.jpg',
  ]);
});

test('sortGalleryNames pushes names that do not start with a digit to the end', () => {
  const sorted = sortGalleryNames([
    'ElevenLabs_image_topaz-image-upscale_2026-08-04T03_50_29.jpg',
    '2026-08-07-commute-nostromo-corridors.jpg',
    'Firefly_Gemini Flash_something 468075.jpg',
    '2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg',
  ]);
  assert.deepEqual(sorted, [
    '2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg',
    '2026-08-07-commute-nostromo-corridors.jpg',
    'Firefly_Gemini Flash_something 468075.jpg',
    'ElevenLabs_image_topaz-image-upscale_2026-08-04T03_50_29.jpg',
  ]);
});

test('sortGalleryNames does not mutate its input', () => {
  const input = ['a.jpg', 'b.jpg'];
  sortGalleryNames(input);
  assert.deepEqual(input, ['a.jpg', 'b.jpg']);
});
```

Note the fourth test: among the two undated names, the descending sort still applies, so `Firefly_` comes before `ElevenLabs_`.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module ... scripts/gallery-manifest.mjs`

- [ ] **Step 4: Write the implementation**

Create `scripts/gallery-manifest.mjs`:

```js
/**
 * Pure helpers behind the gallery manifest. Deliberately free of filesystem
 * access so the ordering rule can be tested on its own.
 */

/** thumbs/<basename>.webp for a JPEG sitting at the repo root. */
export function thumbPathFor(jpegName) {
  const base = jpegName.replace(/\.[^.]*$/, '');
  return `thumbs/${base}.webp`;
}

/**
 * Newest first. The dailies are named YYYY-MM-DD-..., so a plain descending
 * filename sort puts the newest at the top of the page for free.
 *
 * The legacy ElevenLabs_/Firefly_ files carry no date prefix and would sort
 * above 2026-* in a descending sort, landing at the very top. Names that do
 * not begin with a digit are pushed to the end instead.
 *
 * Compared with < / > rather than localeCompare so the order does not shift
 * with the machine's locale.
 */
function compareGalleryNames(a, b) {
  const aDated = /^\d/.test(a);
  const bDated = /^\d/.test(b);
  if (aDated !== bDated) return aDated ? -1 : 1;
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/** Returns a sorted copy; the caller's array is left alone. */
export function sortGalleryNames(names) {
  return [...names].sort(compareGalleryNames);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS — 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/gallery-manifest.mjs tests/gallery-manifest.test.mjs
git commit -m "Add pure helpers for gallery manifest ordering"
```

---

### Task 2: The build script

**Files:**
- Create: `scripts/build-gallery.mjs`
- Create: `tests/build-gallery.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/build-gallery.test.mjs`. It generates its own tiny JPEGs with sharp, so it never touches the real 15 MB images:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildGallery } from '../scripts/build-gallery.mjs';

/** A solid-colour JPEG of the given size, so tests stay fast and self-contained. */
async function writeJpeg(dir, name, width, height) {
  await sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 80, b: 120 } },
  })
    .jpeg({ quality: 80 })
    .toFile(path.join(dir, name));
}

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gallery-test-'));
  await writeJpeg(dir, '2026-08-07-commute-nostromo-corridors.jpg', 1600, 900);
  await writeJpeg(dir, '2026-08-08-ritual-transplant-moomba.jpg', 1200, 968);
  await writeJpeg(dir, 'ElevenLabs_image_legacy.jpg', 800, 600);
  return dir;
}

test('builds a thumbnail and a manifest entry for every root JPEG', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { counts, manifest } = await buildGallery({ rootDir: dir });

  assert.equal(counts.built, 3);
  assert.equal(counts.skipped, 0);
  assert.equal(counts.failed, 0);
  assert.equal(manifest.length, 3);

  for (const entry of manifest) {
    const thumb = await sharp(path.join(dir, entry.thumb)).metadata();
    assert.equal(thumb.format, 'webp');
    assert.equal(thumb.width, 640);
  }
});

test('manifest entries carry the full-size dimensions and byte count', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { manifest } = await buildGallery({ rootDir: dir });
  const entry = manifest.find((e) => e.file === '2026-08-07-commute-nostromo-corridors.jpg');
  const { size } = await stat(path.join(dir, entry.file));

  assert.deepEqual(entry, {
    file: '2026-08-07-commute-nostromo-corridors.jpg',
    thumb: 'thumbs/2026-08-07-commute-nostromo-corridors.webp',
    width: 1600,
    height: 900,
    bytes: size,
  });
});

test('manifest is sorted newest first with undated names last', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { manifest } = await buildGallery({ rootDir: dir });

  assert.deepEqual(
    manifest.map((e) => e.file),
    [
      '2026-08-08-ritual-transplant-moomba.jpg',
      '2026-08-07-commute-nostromo-corridors.jpg',
      'ElevenLabs_image_legacy.jpg',
    ],
  );
});

test('manifest is written to disk as JSON', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { manifest } = await buildGallery({ rootDir: dir });
  const onDisk = JSON.parse(await readFile(path.join(dir, 'gallery.json'), 'utf8'));

  assert.deepEqual(onDisk, manifest);
});

test('a second run skips every thumbnail but still rewrites the manifest', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await buildGallery({ rootDir: dir });
  const second = await buildGallery({ rootDir: dir });

  assert.equal(second.counts.built, 0);
  assert.equal(second.counts.skipped, 3);
  assert.equal(second.manifest.length, 3);
});

test('a source newer than its thumbnail is rebuilt', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await buildGallery({ rootDir: dir });

  const touched = path.join(dir, 'ElevenLabs_image_legacy.jpg');
  const future = new Date(Date.now() + 60_000);
  await utimes(touched, future, future);

  const second = await buildGallery({ rootDir: dir });
  assert.equal(second.counts.built, 1);
  assert.equal(second.counts.skipped, 2);
});

test('--force rebuilds everything', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  await buildGallery({ rootDir: dir });
  const forced = await buildGallery({ rootDir: dir, force: true });

  assert.equal(forced.counts.built, 3);
  assert.equal(forced.counts.skipped, 0);
});

test('an unreadable JPEG is counted as failed and left out of the manifest', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dir, '2026-08-09-corrupt.jpg'), 'this is not a JPEG');

  const { counts, manifest } = await buildGallery({ rootDir: dir });

  assert.equal(counts.failed, 1);
  assert.equal(counts.built, 3);
  assert.equal(manifest.length, 3);
  assert.ok(!manifest.some((e) => e.file === '2026-08-09-corrupt.jpg'));
});

test('non-JPEG files at the root are ignored', async (t) => {
  const dir = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(dir, 'README.md'), '# not an image');
  await writeFile(path.join(dir, 'package.json'), '{}');

  const { manifest } = await buildGallery({ rootDir: dir });
  assert.equal(manifest.length, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — `Cannot find module ... scripts/build-gallery.mjs`

- [ ] **Step 3: Write the implementation**

Create `scripts/build-gallery.mjs`:

```js
#!/usr/bin/env node
/**
 * Build the gallery's thumbnails and manifest from the JPEGs committed at the
 * repo root.
 *
 * Reads the committed JPEGs rather than RAW/ on purpose: RAW/ holds masters for
 * only some of the images, while every image that ships needs a thumbnail.
 *
 * Both the thumbnails and gallery.json are committed - GitHub Pages has no
 * directory listing, so the manifest is how the page learns what exists.
 *
 *   npm run gallery            build whatever is new
 *   npm run gallery -- --force re-encode every thumbnail
 */
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { sortGalleryNames, thumbPathFor } from './gallery-manifest.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 640 is roughly 2x the ~320px grid tile, so thumbnails stay sharp on retina
// without the page getting heavy. Measured on a real 5504x3072 frame, a 640px
// WebP lands at 39.7 KB at q68, 42.5 at q72, 48.8 at q78 - q72 is the knee.
const THUMB_WIDTH = 640;
const THUMB_OPTIONS = { quality: 72 };

const MANIFEST_NAME = 'gallery.json';
const THUMB_DIR = 'thumbs';

/** Newest mtime wins: true when the thumbnail is already up to date. */
async function isUpToDate(sourcePath, targetPath) {
  try {
    const [source, target] = await Promise.all([stat(sourcePath), stat(targetPath)]);
    return target.mtimeMs >= source.mtimeMs;
  } catch {
    return false; // no thumbnail yet
  }
}

async function buildThumb(rootDir, name, force) {
  const sourcePath = path.join(rootDir, name);
  const thumb = thumbPathFor(name);
  const thumbPath = path.join(rootDir, thumb);

  // Read metadata before encoding so a corrupt source fails before it can
  // leave a half-written thumbnail behind.
  const { width, height } = await sharp(sourcePath).metadata();
  const { size: bytes } = await stat(sourcePath);

  let status = 'skipped';
  if (force || !(await isUpToDate(sourcePath, thumbPath))) {
    await sharp(sourcePath).resize({ width: THUMB_WIDTH }).webp(THUMB_OPTIONS).toFile(thumbPath);
    status = 'built';
  }

  return { status, entry: { file: name, thumb, width, height, bytes } };
}

/**
 * Encodes any missing thumbnails and rewrites the manifest.
 *
 * The manifest is rewritten on every run, covering every root JPEG, even when
 * no thumbnail needed encoding - otherwise it would drift out of date whenever
 * a run happened to be a no-op.
 */
export async function buildGallery({ rootDir = repoRoot, force = false, log = () => {} } = {}) {
  await mkdir(path.join(rootDir, THUMB_DIR), { recursive: true });

  const entries = await readdir(rootDir);
  const sources = sortGalleryNames(
    entries.filter((name) => path.extname(name).toLowerCase() === '.jpg'),
  );

  const counts = { built: 0, skipped: 0, failed: 0 };
  const manifest = [];

  // Sequential for the same reason convert-raw.mjs is: these are 5504x3072
  // sources, and running them in parallel trades a lot of memory for very
  // little wall-clock.
  for (const name of sources) {
    try {
      const { status, entry } = await buildThumb(rootDir, name, force);
      counts[status] += 1;
      manifest.push(entry);
      if (status === 'built') log(`  build ${entry.thumb}`);
    } catch (error) {
      counts.failed += 1;
      log(`  FAIL  ${name}: ${error.message}`);
    }
  }

  await writeFile(
    path.join(rootDir, MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return { counts, manifest };
}

async function main() {
  const force = process.argv.includes('--force');
  const { counts, manifest } = await buildGallery({
    rootDir: repoRoot,
    force,
    log: console.log,
  });

  console.log(
    `\n${counts.built} built, ${counts.skipped} skipped, ${counts.failed} failed` +
      ` - ${manifest.length} image${manifest.length === 1 ? '' : 's'} in ${MANIFEST_NAME}`,
  );
  if (counts.failed > 0) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS — 14 tests passing across both files.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-gallery.mjs tests/build-gallery.test.mjs
git commit -m "Add gallery thumbnail and manifest build script"
```

---

### Task 3: Generate the real thumbnails and manifest

No tests here — this runs the script just built against the actual 39 images and commits the output.

**Files:**
- Create: `thumbs/*.webp` (39 files, generated)
- Create: `gallery.json` (generated)

- [ ] **Step 1: Run the build**

```bash
npm run gallery
```

Expected: 39 `build thumbs/...` lines, then `39 built, 0 skipped, 0 failed - 39 images in gallery.json`.

- [ ] **Step 2: Verify the output size is in the expected range**

```bash
du -sh thumbs && ls thumbs | wc -l
```

Expected: about **1.7 MB** across **39** files. If it comes out dramatically larger, stop and re-check `THUMB_OPTIONS` before committing — this is the number that keeps the page light.

- [ ] **Step 3: Verify the manifest looks right**

```bash
node -e "const m=require('./gallery.json'); console.log(m.length, m[0].file, m[0].width+'x'+m[0].height); console.log(m.at(-1).file)"
```

Expected: `39`, first entry `2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg` at `5504x3072`, last entry one of the `ElevenLabs_*` files.

- [ ] **Step 4: Confirm a second run is a no-op**

```bash
npm run gallery
```

Expected: `0 built, 39 skipped, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add thumbs gallery.json
git commit -m "Add generated gallery thumbnails and manifest"
```

---

### Task 4: The gallery page

**Files:**
- Create: `index.html`
- Create: `.nojekyll`

- [ ] **Step 1: Create the Jekyll opt-out**

```bash
touch .nojekyll
```

An empty file. Without it Pages runs the repo through Jekyll, which is pure overhead here.

- [ ] **Step 2: Write `index.html`**

Tiles are built with `document.createElement` and `textContent` rather than `innerHTML`, so filenames containing spaces, quotes, or `&` cannot break the markup — several of the legacy files have spaces in them.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fun-backgrounds</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0d0f12;
    --surface: #16191e;
    --border: #262b33;
    --text: #e8eaed;
    --muted: #939ca7;
    --accent: #7cc4ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 1600px; margin: 0 auto; padding: 0 1.5rem; }
  header { padding: 2.5rem 0 1.25rem; }
  h1 { margin: 0 0 .35rem; font-size: 1.4rem; letter-spacing: -.01em; }
  header p { margin: 0; color: var(--muted); font-size: .9rem; }
  main { padding-bottom: 4rem; }

  #grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tile {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .shot {
    display: block;
    position: relative;
    background: #000;
    /* aspect-ratio is set inline per image, from the manifest dimensions, so
       the box is reserved before the thumbnail loads and the handful of
       non-16:9 images are not cropped. */
  }
  .shot img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: 0;
  }
  .shot.missing { background: var(--surface); }
  .shot.missing img { display: none; }
  .shot.missing::after {
    content: "thumbnail unavailable";
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: .85rem;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: .75rem;
    padding: .6rem .75rem;
    border-top: 1px solid var(--border);
  }
  .name {
    flex: 1;
    min-width: 0;
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size { color: var(--muted); font-size: 12px; white-space: nowrap; }

  .actions { display: flex; gap: .4rem; padding: 0 .75rem .75rem; }
  .actions a, .actions button {
    flex: 1;
    padding: .4rem .5rem;
    font: inherit;
    font-size: 13px;
    text-align: center;
    text-decoration: none;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
  .actions a:hover, .actions button:hover { border-color: var(--accent); color: var(--accent); }

  #status { color: var(--muted); padding: 2rem 0; }
  #status.error { color: #ff9c8a; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>fun-backgrounds</h1>
    <p id="count">Loading&hellip;</p>
  </header>
  <main>
    <p id="status">Loading&hellip;</p>
    <ul id="grid" hidden></ul>
  </main>
</div>

<script>
const grid = document.getElementById('grid');
const status = document.getElementById('status');
const count = document.getElementById('count');

function formatSize(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Absolute URL for an image, so a copied link works pasted anywhere. */
function absoluteUrl(file) {
  return new URL(file, location.href).href;
}

async function copyToClipboard(text) {
  // navigator.clipboard needs a secure context; file:// and plain http on a
  // non-localhost host fall back to the old textarea trick.
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  document.execCommand('copy');
  field.remove();
}

function buildTile(entry) {
  const tile = document.createElement('li');
  tile.className = 'tile';

  const shot = document.createElement('a');
  shot.className = 'shot';
  shot.href = entry.file;
  shot.target = '_blank';
  shot.rel = 'noopener';
  shot.style.aspectRatio = `${entry.width} / ${entry.height}`;

  const img = document.createElement('img');
  img.src = entry.thumb;
  img.alt = entry.file;
  img.loading = 'lazy';
  img.decoding = 'async';
  // A missing thumbnail leaves the reserved box and a label rather than a
  // broken-image icon. The links below still work.
  img.addEventListener('error', () => shot.classList.add('missing'));
  shot.appendChild(img);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = entry.file;
  name.title = entry.file;

  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = `${entry.width}\u00d7${entry.height} \u00b7 ${formatSize(entry.bytes)}`;

  meta.append(name, size);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const download = document.createElement('a');
  download.href = entry.file;
  download.download = entry.file;
  download.textContent = 'Download';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy link';
  copy.addEventListener('click', async () => {
    try {
      await copyToClipboard(absoluteUrl(entry.file));
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
    setTimeout(() => { copy.textContent = 'Copy link'; }, 1500);
  });

  actions.append(download, copy);
  tile.append(shot, meta, actions);
  return tile;
}

async function render() {
  let manifest;
  try {
    const response = await fetch('gallery.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`gallery.json returned ${response.status}`);
    manifest = await response.json();
  } catch (error) {
    status.className = 'error';
    status.textContent = `Could not load the gallery: ${error.message}`;
    count.textContent = '';
    return;
  }

  const total = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  count.textContent =
    `${manifest.length} background${manifest.length === 1 ? '' : 's'}` +
    ` \u00b7 ${(total / 1073741824).toFixed(2)} GB at full size`;

  grid.append(...manifest.map(buildTile));
  status.remove();
  grid.hidden = false;
}

render();
</script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add index.html .nojekyll
git commit -m "Add gallery page"
```

---

### Task 5: Verify the page in a browser

The page has no automated tests — it is a single static file whose behaviour is visual. Verify it by actually serving and looking at it. The server lives in the scratchpad so it never lands in the repo.

**Files:**
- Create: `C:/Users/zdesk/AppData/Local/Temp/claude/C--Projects-fun-backgrounds/935df4d6-535d-4b03-a914-c1272b848713/scratchpad/serve.mjs` (throwaway, not committed)

- [ ] **Step 1: Write a throwaway static server**

Create `serve.mjs` in the session scratchpad directory (referred to below as `<scratchpad>`, the full path above):

```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.argv[2];
const types = {
  '.html': 'text/html', '.json': 'application/json',
  '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(path.resolve(root))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5173, () => console.log('http://localhost:5173'));
```

- [ ] **Step 2: Start it in the background**

```bash
node "<scratchpad>/serve.mjs" "C:/Projects/fun-backgrounds"
```

Run with `run_in_background: true`. Expected: `http://localhost:5173`.

- [ ] **Step 3: Open the page and check it**

Use `mcp__Claude_Browser__preview_start` with `url: "http://localhost:5173"`, then take a screenshot.

Confirm, and report each explicitly:
1. The header reads `39 backgrounds · 0.28 GB at full size`
2. The grid renders in multiple columns with no broken images and no visible layout shift while scrolling
3. The newest daily (`2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg`) is the first tile
4. The `ElevenLabs_*` files are at the very bottom
5. `mcp__Claude_Browser__read_console_messages` reports no errors

- [ ] **Step 4: Check the narrow layout**

Resize to the `mobile` preset and screenshot again. Expected: a single column, tile controls still readable, no horizontal page scroll.

- [ ] **Step 5: Check the error path for real**

Move the manifest aside, reload, and confirm the page says so instead of going blank:

```bash
mv gallery.json gallery.json.bak
```

Reload the page and screenshot. Expected: the message `Could not load the gallery: gallery.json returned 404` in the error colour, and an empty header subtitle — not a blank screen and not a spinner stuck on "Loading…".

Then put it back and confirm the page recovers:

```bash
mv gallery.json.bak gallery.json
```

Reload and confirm the grid renders again. **Verify `git status` is clean before moving on** — if `gallery.json` is missing or renamed at this point, the rename did not get undone.

- [ ] **Step 6: Stop the server**

Stop the background task.

- [ ] **Step 7: Commit if anything needed fixing**

If Steps 3–5 turned up problems, fix `index.html` and commit:

```bash
git add index.html
git commit -m "Fix gallery page layout issues found in browser check"
```

If nothing needed fixing, there is nothing to commit — say so rather than inventing a commit.

---

### Task 6: Turn on GitHub Pages

Enabling Pages publishes the repo's contents to a public URL. **Do not run this without confirming with the user first** — it is an outward-facing change, and the repo's visibility determines whether the images become publicly reachable.

- [ ] **Step 1: Push the work**

```bash
git push origin main
```

- [ ] **Step 2: Confirm with the user**

Ask whether to enable Pages, and confirm whether the repo is public or private. On a private repo, Pages requires a paid plan; if it is private and unpaid, stop here and report that.

- [ ] **Step 3: Enable Pages, after confirmation**

```bash
gh api -X POST repos/ZebLawrence/fun-backgrounds/pages -f "source[branch]=main" -f "source[path]=/"
```

If it returns 409, Pages is already enabled — switch it instead:

```bash
gh api -X PUT repos/ZebLawrence/fun-backgrounds/pages -f "source[branch]=main" -f "source[path]=/"
```

- [ ] **Step 4: Verify the deploy**

```bash
gh api repos/ZebLawrence/fun-backgrounds/pages --jq '.status, .html_url'
```

Wait for `built`, then fetch the live page and confirm it serves:

```bash
curl -sI https://zeblawrence.github.io/fun-backgrounds/gallery.json | head -1
```

Expected: `HTTP/2 200`.

---

## Follow-up worth noting, not doing

- **The 1 GB Pages ceiling.** The repo is at 286 MB and grows about 1 GB/year. Roughly eight months of runway. Recorded in the spec; no action now.
- **Stale thumbnails.** If an image is ever deleted from the root, its `thumbs/*.webp` lingers. Not worth pruning logic until an image is actually deleted.
- **The 10 legacy filenames.** They sort to the bottom by design. Renaming them into the daily convention is a separate cleanup.
- **The daily workflow becomes** `npm run convert` (when a RAW master exists) → `npm run gallery` → commit.
