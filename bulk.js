// Many links in one go. They run one after another (not in parallel) so the
// browser and the free translator aren't overloaded; each finished product is
// saved straight away, so nothing is lost if the run is stopped halfway.

import { extractProduct } from './extract.js';
import { recordFromProduct, saveProduct } from './storage.js';

const PAUSE_MS = 2500; // breathing room for the keyless translator between products

let job = null;

export function bulkStatus() {
  return job;
}

export function startBulk(urls, { fast = false } = {}) {
  if (job?.running) throw new Error('Toplu işlem zaten çalışıyor. Bitmesini bekle ya da durdur.');
  const lines = urls.map((u) => String(u).trim()).filter(Boolean);
  const clean = [...new Set(lines.filter((u) => /^https?:\/\//i.test(u)))];
  if (!clean.length) throw new Error('Geçerli link yok (her satıra bir link, http:// veya https:// ile).');
  job = {
    id: Date.now().toString(36),
    running: true,
    stopRequested: false,
    fast,
    startedAt: new Date().toISOString(),
    ignored: lines.filter((u) => !/^https?:\/\//i.test(u)).length,
    items: clean.map((url) => ({ url, status: 'pending' })),
  };
  run(job);
  return job;
}

export function stopBulk() {
  if (job?.running) job.stopRequested = true;
  return job;
}

async function run(j) {
  for (const item of j.items) {
    if (j.stopRequested) {
      item.status = 'skipped';
      continue;
    }
    item.status = 'running';
    item.startedAt = Date.now();
    try {
      const product = await extractProduct(item.url, null, { fast: j.fast });
      const saved = await saveProduct({ record: recordFromProduct(product), state: product });
      Object.assign(item, { status: 'done', id: saved.id, name: saved.name, sku: saved.sku, images: saved.images });
      const failedLangs = Object.entries(product.translations || {}).filter(([, t]) => t.source === 'error').map(([l]) => l.toUpperCase());
      if (failedLangs.length) item.warning = `Çevrilemeyen diller: ${failedLangs.join(', ')}`;
    } catch (err) {
      item.status = 'error';
      item.error = err.name === 'TimeoutError' ? 'Site yanıt vermedi.' : err.message;
    }
    item.seconds = Math.round((Date.now() - item.startedAt) / 1000);
    if (!j.stopRequested && j.items.some((i) => i.status === 'pending')) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  j.running = false;
  j.finishedAt = new Date().toISOString();
}
