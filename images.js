import { createHash } from 'node:crypto';
import sharp from 'sharp';
import JSZip from 'jszip';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const SIZE = 800;
const MIN_SIDE = 300; // smaller than this is a thumbnail, icon or placeholder

// downloaded originals and converted results, kept so previews and the ZIP
// don't download/convert the same image again
const rawCache = new Map();
const webpCache = new Map();
const CACHE_MAX = 80;

function remember(map, key, value) {
  map.set(key, value);
  if (map.size > CACHE_MAX) map.delete(map.keys().next().value);
  return value;
}

async function fetchRaw(url, referer) {
  if (rawCache.has(url)) return rawCache.get(url);
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
  return remember(rawCache, url, Buffer.from(await res.arrayBuffer()));
}

async function measure(urls, referer) {
  const results = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      try {
        const buf = await fetchRaw(urls[i], referer);
        const meta = await sharp(buf, { animated: false }).metadata();
        results[i] = { url: urls[i], width: meta.width, height: meta.height, hash: createHash('sha1').update(buf).digest('hex') };
      } catch {
        results[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return results.filter((r) => r && r.width);
}

// Downloads the candidates tier by tier (see extractImages), measures them and
// keeps real product photos: 1×1 placeholders, icons, thumbnails and identical
// files are dropped. Lower tiers are only used when the better ones fall short.
export async function probeImages(candidates, referer) {
  const tiers = [...new Set(candidates.map((c) => c.tier))].sort();
  const hashes = new Set();
  let keep = [];
  let small = [];
  for (const tier of tiers) {
    const found = await measure(candidates.filter((c) => c.tier === tier).map((c) => c.url), referer);
    for (const r of found) {
      if (hashes.has(r.hash)) continue;
      hashes.add(r.hash);
      if (Math.min(r.width, r.height) >= MIN_SIDE) keep.push(r);
      else if (Math.min(r.width, r.height) >= 100) small.push(r);
    }
    if (keep.length >= 2) break;
  }
  // a shop that only has small photos still gets its best ones
  if (!keep.length) keep = small;
  return keep.slice(0, 20).map(({ url, width, height }) => ({ url, width, height, upscaled: Math.max(width, height) < SIZE }));
}

// Product photo -> 800×800 WebP. The whole product stays visible (no cropping):
// the image is fitted inside the square and the rest is filled with white.
export async function toWebp(url, referer) {
  if (webpCache.has(url)) return webpCache.get(url);
  const input = await fetchRaw(url, referer);
  const output = await sharp(input, { animated: false })
    .rotate() // respect EXIF orientation from phone photos
    .flatten({ background: '#ffffff' })
    .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' })
    // full-resolution colour keeps thin text and edges crisp
    .webp({ quality: 92, smartSubsample: true, effort: 5 })
    .toBuffer();
  return remember(webpCache, url, output);
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
