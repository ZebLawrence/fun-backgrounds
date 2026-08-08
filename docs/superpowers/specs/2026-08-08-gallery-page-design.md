# Gallery page on GitHub Pages

Status: approved 2026-08-08

## Problem

The repo holds 39 committed JPEGs at its root with no way to browse them. Opening
them means cloning the repo or clicking through GitHub's blob view one file at a
time. The goal is a single page, hosted on GitHub Pages, that shows every image
and lets you grab the full-size file.

Two facts about the existing repo drive the design:

- **The images are heavy.** 286 MB across 39 files, averaging 7.3 MB, largest
  15.5 MB. 36 of them are 5504x3072; the outliers are 2304x1856, 2560x1536, and
  2656x1600. A page that pointed `<img src>` at the committed files would be a
  286 MB load. Thumbnails are mandatory, not an optimization.
- **`RAW/` is not a reliable source.** It holds 10 PNG masters for 39 JPEGs;
  the masters for the daily images are not on this machine. Thumbnail generation
  must read the committed JPEGs at the repo root, independent of `RAW/`.

## Scope

In scope: a thumbnail build script, a generated manifest, a single static page,
and the Pages configuration to serve it.

Out of scope, deliberately:

- Lightbox / full-screen viewer. The thumbnail links to the real JPEG; the
  browser already provides zoom and save.
- Filtering by concept, grouping by date, or any other use of the structure
  encoded in filenames. The manifest is a flat enumeration.
- Renaming the 10 legacy `ElevenLabs_*` / `Firefly_*` files. Separate cleanup.
- Search, tags, prompts, or per-image notes.

## Deployment

Pages serves from **`main`, root directory** ("Deploy from a branch"). No CI
workflow. The images already live at the root, so nothing moves and nothing is
duplicated. An empty `.nojekyll` at the root disables Jekyll processing.

Site URL: `https://zeblawrence.github.io/fun-backgrounds/`

New files, all at the repo root unless noted:

| Path                       | Committed | Purpose                                |
| -------------------------- | --------- | -------------------------------------- |
| `index.html`               | yes       | The gallery page, self-contained       |
| `gallery.json`             | yes       | Generated manifest of images           |
| `thumbs/*.webp`            | yes       | Generated thumbnails                   |
| `.nojekyll`                | yes       | Disable Jekyll on Pages                |
| `scripts/build-gallery.mjs`| yes       | Generates `thumbs/` and `gallery.json` |

## Thumbnail build — `scripts/build-gallery.mjs`

A sibling to `scripts/convert-raw.mjs`, following its established conventions:
sharp, sequential processing, mtime-based skip, a `--force` flag, and a summary
line of converted/skipped/failed counts. Exposed as `npm run gallery`.

Behavior:

1. Scan the repo root for `*.jpg` (case-insensitive extension match), sorted.
2. For each source, write `thumbs/<basename>.webp` — resized to **640px wide**,
   preserving aspect ratio, **WebP quality 72**. 640 rather than 320 so tiles
   stay sharp on retina displays. Expected output is roughly 40-60 KB each:
   about 2 MB for the current 39 images, growing about 2 MB/year.
3. Skip a thumbnail when it already exists and its mtime is at or after the
   source's, so a routine run after adding one daily image touches one file.
   `--force` re-encodes everything.
4. Emit `gallery.json` covering every root JPEG, regardless of whether its
   thumbnail was regenerated this run.

A thumbnail that fails to encode is reported and counted as failed; the script
exits non-zero if any failed, matching `convert-raw.mjs`. A failed image is
omitted from the manifest rather than being listed with a thumbnail that does
not exist.

### Manifest format

`gallery.json` is a JSON array. One entry per root JPEG:

```json
[
  {
    "file": "2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.jpg",
    "thumb": "thumbs/2026-08-08-ritual-transplant-moomba-wake-boat-forbidden-forest.webp",
    "width": 5504,
    "height": 3072,
    "bytes": 2867800
  }
]
```

`width`/`height` are the **full-size** dimensions, carried so the grid can
reserve a correctly-shaped box before the thumbnail loads. `bytes` is the
full-size file size, shown on the tile so the size of a download is visible
before clicking it.

Pages has no directory listing, so the manifest is what tells the page which
images exist. It carries no date, concept, or title fields — filename only.

### Sort order

Filename **descending**, which puts the newest daily first for free because the
dailies are date-prefixed.

One adjustment: filenames not beginning with a digit sort **after** those that
do. Without it the 10 legacy `ElevenLabs_*` / `Firefly_*` files would sort above
`2026-*` and land at the top of the page. This is a character-class check on the
first character, not filename parsing.

## The page — `index.html`

A single self-contained file: inline CSS, inline JS, no dependencies, no build
step, no framework. It fetches `gallery.json` on load and renders the grid.

Layout and styling:

- Responsive CSS grid, `repeat(auto-fill, minmax(320px, 1fr))`
- Dark, image-forward theme; chrome stays out of the way of the images
- Each tile sets `aspect-ratio` from the manifest's `width`/`height`, so there
  is no layout shift while scrolling and the three odd-sized images are not
  cropped to 16:9
- Thumbnails use `loading="lazy"` and `decoding="async"`

Per-tile behavior:

- The thumbnail is a link to the full-size JPEG, opening in a new tab
- **Download** — an `<a download>` pointing at the full JPEG, so it saves under
  its real filename rather than navigating
- **Copy link** — copies the absolute
  `https://zeblawrence.github.io/fun-backgrounds/<file>` URL to the clipboard,
  with a brief inline confirmation
- Filename and human-readable file size are shown on the tile

Error handling:

- If `gallery.json` fails to load or parse, the page renders a plain error
  message, not an empty screen
- A thumbnail that 404s falls back to a neutral placeholder tile rather than a
  broken-image icon; the tile's links still work

## Workflow after this ships

Adding a daily image becomes:

```
npm run convert     # RAW/*.png -> root/*.jpg   (unchanged, when a master exists)
npm run gallery     # -> thumbs/*.webp + gallery.json
git add ... && git commit
```

`npm run gallery` is the only new step, and it is idempotent.

## Known limit

GitHub Pages soft-caps a published site at 1 GB. The repo sits at 286 MB and
grows roughly 1 GB/year at quality 80, so this configuration runs comfortably
for about eight months before pressing that ceiling. No action now. When it
does bite, the fix is moving older images off Pages — a `docs/` publish root, or
an external host — which is a change to what gets published, not to the gallery
itself.
