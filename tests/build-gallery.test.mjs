import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildGallery } from '../scripts/build-gallery.mjs';

// sharp's operation cache keeps a file handle open on images it has read, which
// on Windows makes the temp-directory cleanup below fail with EBUSY when a test
// reads a thumbnail back before removing the directory. The cache buys nothing
// here - every test works on its own fresh fixture.
sharp.cache(false);

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

  await writeFile(path.join(dir, 'README.md'), '# not an image');
  await writeFile(path.join(dir, 'package.json'), '{}');

  const { manifest } = await buildGallery({ rootDir: dir });
  assert.equal(manifest.length, 3);
});
