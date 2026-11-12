import sharp from 'sharp';
import JSZip from 'jszip';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const SIZE = 800;

// converted images are kept for a while so the ZIP doesn't redo the work
const cache = new Map();
const CACHE_MAX = 60;

// Product photo -> 800×800 WebP. The whole product stays visible (no cropping):
// the image is fitted inside the square and the rest is filled with white.
export async function toWebp(url, referer) {
  if (cache.has(url)) return cache.get(url);

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      // some shops refuse images requested without their own page as referer
      ...(referer ? { Referer: referer } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Görsel indirilemedi (HTTP ${res.status})`);

  const input = Buffer.from(await res.arrayBuffer());
  const output = await sharp(input, { animated: false })
    .rotate() // respect EXIF orientation from phone photos
    .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 85 })
    .toBuffer();

  cache.set(url, output);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return output;
}

// All images in one ZIP: <base>_1.webp, <base>_2.webp, ...
// Images that fail are listed in hatalar.txt instead of failing the whole ZIP.
export async function webpZip(urls, base, referer) {
  const zip = new JSZip();
  const failed = [];
  let n = 0;
  for (const url of urls) {
    try {
      zip.file(`${base}_${++n}.webp`, await toWebp(url, referer));
    } catch (err) {
      n--;
      failed.push(`${url}  ->  ${err.message}`);
    }
  }
  if (failed.length) zip.file('hatalar.txt', failed.join('\r\n'));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), count: n, failed: failed.length };
}
