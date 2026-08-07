#!/usr/bin/env node
/**
 * Convert the full-size PNG sources in RAW/ into quality-80 JPEGs at the repo root.
 *
 * RAW/ is gitignored and holds the lossless masters, which stay on this machine.
 * The JPEGs it produces are what actually gets committed.
 * Output keeps the source basename and the source dimensions - no resizing.
 *
 * By default a PNG is skipped when its JPEG already exists and is newer than
 * the source, so a normal run only picks up newly added raws.
 *
 *   npm run convert            convert whatever is new
 *   npm run convert -- --force re-encode every raw
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(repoRoot, 'RAW');

// 4:2:0 matches the JPEGs already committed to this repo. '4:4:4' would skip
// chroma subsampling entirely at the cost of a noticeably larger file.
//
// Quality dropped 100 -> 80 on 2026-08-07. Measured on a real 5504x3072 frame:
// q100 13.5 MB, q95 6.8, q90 4.5, q85 3.4, q80 2.8, q75 2.4. q80 is ~21% of q100
// for no visible loss at this resolution, which takes repo growth from roughly
// 4.4 GB/year to under 1 GB/year. The lossless PNG master stays in RAW/.
const JPEG_OPTIONS = { quality: 80, chromaSubsampling: '4:2:0' };

const force = process.argv.includes('--force');

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Newest mtime wins: returns true when the JPEG is already up to date. */
async function isUpToDate(sourcePath, targetPath) {
  try {
    const [source, target] = await Promise.all([stat(sourcePath), stat(targetPath)]);
    return target.mtimeMs >= source.mtimeMs;
  } catch {
    return false; // no JPEG yet
  }
}

async function convert(name) {
  const sourcePath = path.join(rawDir, name);
  const targetName = `${path.basename(name, path.extname(name))}.jpg`;
  const targetPath = path.join(repoRoot, targetName);

  if (!force && (await isUpToDate(sourcePath, targetPath))) {
    console.log(`  skip  ${targetName} (up to date)`);
    return 'skipped';
  }

  const { size: sourceSize } = await stat(sourcePath);
  const { width, height } = await sharp(sourcePath).jpeg(JPEG_OPTIONS).toFile(targetPath);
  const { size: targetSize } = await stat(targetPath);

  console.log(`  write ${targetName}`);
  console.log(`        ${width}x${height}  ${mb(sourceSize)} PNG -> ${mb(targetSize)} JPEG`);
  return 'converted';
}

async function main() {
  let entries;
  try {
    entries = await readdir(rawDir);
  } catch {
    console.error(`No RAW/ directory at ${rawDir} - nothing to convert.`);
    process.exit(1);
  }

  const sources = entries.filter((name) => path.extname(name).toLowerCase() === '.png').sort();

  if (sources.length === 0) {
    console.log('No PNGs in RAW/ - nothing to convert.');
    return;
  }

  console.log(`Converting ${sources.length} raw${sources.length === 1 ? '' : 's'} at quality ${JPEG_OPTIONS.quality}${force ? ' (--force)' : ''}\n`);

  const counts = { converted: 0, skipped: 0, failed: 0 };

  // Sequential: these are 5504x3072 sources and running them in parallel just
  // trades a lot of memory for very little wall-clock.
  for (const name of sources) {
    try {
      counts[await convert(name)] += 1;
    } catch (error) {
      counts.failed += 1;
      console.error(`  FAIL  ${name}: ${error.message}`);
    }
  }

  console.log(`\n${counts.converted} converted, ${counts.skipped} skipped, ${counts.failed} failed`);
  if (counts.failed > 0) process.exit(1);
}

await main();
