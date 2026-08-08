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
