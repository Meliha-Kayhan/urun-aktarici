// Saved products and settings live as JSON files under ./data (not in git):
//   data/products/<id>.json   one file per product
//   data/settings.json        glossary + fixed texts

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DATA = fileURLToPath(new URL('./data/', import.meta.url));
const PRODUCTS = path.join(DATA, 'products');
const SETTINGS = path.join(DATA, 'settings.json');

const ID_RE = /^[a-z0-9-]{4,80}$/;

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  // write then rename so a crash never leaves half a file behind
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 1), 'utf8');
  await rename(tmp, file);
}

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function newId(record) {
  return `${slug(record?.sku || record?.languages?.tr?.name) || 'urun'}-${Date.now().toString(36)}`;
}

// The export-ready record of a freshly extracted (not yet edited) product.
// The screen builds the same shape from its edited fields.
export function recordFromProduct(p) {
  const languages = {};
  for (const [code, t] of Object.entries(p.translations || {})) {
    const { name, category, shortDescription, descriptionHtml, descriptionText, specs } = t;
    languages[code] = { name, category, shortDescription, descriptionHtml, descriptionText, specs };
  }
  return {
    url: p.url,
    sku: p.sku,
    barcode: p.barcode,
    brand: p.brand,
    price: p.price,
    currency: p.currency,
    images: (p.images || []).filter((im) => !im.removed).map((im) => (typeof im === 'string' ? im : im.url)),
    documents: p.documents || [],
    variants: p.variants || [],
    languages,
  };
}

// ---------- products ----------
// A saved product keeps two things:
//   record  the clean, edited data used for exports (what "JSON indir" gives)
//   state   the full screen state, so the product reopens exactly as it was

export async function saveProduct({ id, record, state }) {
  if (id && !ID_RE.test(id)) throw new Error('Geçersiz kayıt.');
  id ||= newId(record);
  const file = path.join(PRODUCTS, `${id}.json`);
  let createdAt = new Date().toISOString();
  try {
    createdAt = JSON.parse(await readFile(file, 'utf8')).createdAt || createdAt;
  } catch {
    /* new product */
  }
  const saved = { id, createdAt, savedAt: new Date().toISOString(), record, state };
  await writeJson(file, saved);
  return summary(saved);
}

export async function getProduct(id) {
  if (!ID_RE.test(id)) throw new Error('Geçersiz kayıt.');
  return JSON.parse(await readFile(path.join(PRODUCTS, `${id}.json`), 'utf8'));
}

export async function deleteProduct(id) {
  if (!ID_RE.test(id)) throw new Error('Geçersiz kayıt.');
  await rm(path.join(PRODUCTS, `${id}.json`), { force: true });
}

function summary(p) {
  const r = p.record || {};
  return {
    id: p.id,
    sku: r.sku || '',
    name: r.languages?.tr?.name || r.languages?.en?.name || '',
    url: r.url || '',
    image: r.images?.[0] || '',
    images: r.images?.length || 0,
    variants: r.variants?.length || 0,
    createdAt: p.createdAt,
    savedAt: p.savedAt,
  };
}

export async function listProducts() {
  let files = [];
  try {
    files = (await readdir(PRODUCTS)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push(summary(JSON.parse(await readFile(path.join(PRODUCTS, f), 'utf8'))));
    } catch {
      /* skip a damaged file rather than breaking the whole list */
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

// ---------- settings ----------

const DEFAULT_SETTINGS = {
  // [{ lang: 'tr' | 'en' | 'nl' | '*', find: 'Gofret', replace: 'Wafer' }]
  glossary: [],
  // text appended to every description, per language
  footers: { tr: '', en: '', nl: '' },
};

let settingsCache = null;

export async function getSettings() {
  if (settingsCache) return settingsCache;
  try {
    const s = JSON.parse(await readFile(SETTINGS, 'utf8'));
    settingsCache = { ...DEFAULT_SETTINGS, ...s, footers: { ...DEFAULT_SETTINGS.footers, ...s.footers } };
  } catch {
    settingsCache = structuredClone(DEFAULT_SETTINGS);
  }
  return settingsCache;
}

export async function saveSettings(input) {
  const glossary = (Array.isArray(input?.glossary) ? input.glossary : [])
    .map((g) => ({ lang: ['tr', 'en', 'nl'].includes(g.lang) ? g.lang : '*', find: String(g.find || '').trim(), replace: String(g.replace ?? '').trim() }))
    .filter((g) => g.find);
  const footers = {};
  for (const l of ['tr', 'en', 'nl']) footers[l] = String(input?.footers?.[l] || '').trim();
  settingsCache = { glossary, footers };
  await writeJson(SETTINGS, settingsCache);
  return settingsCache;
}
