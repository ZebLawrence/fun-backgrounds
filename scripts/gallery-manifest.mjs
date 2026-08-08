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
