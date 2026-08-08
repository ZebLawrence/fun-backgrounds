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
