import express from 'express';
import { fileURLToPath } from 'node:url';
import { extractProduct } from './extract.js';
import { LANGS, provider, translateFields } from './translate.js';
import { toWebp, webpZip } from './images.js';
import { deleteProduct, getProduct, getSettings, listProducts, saveProduct, saveSettings } from './storage.js';
import { exportFile } from './export.js';
import { applyGlossary } from './postprocess.js';
import { bulkStatus, startBulk, stopBulk } from './bulk.js';

const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

app.post('/api/extract', async (req, res) => {
  const { url, html, fast } = req.body || {};
  try {
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Geçerli bir ürün linki girin (http:// veya https:// ile başlamalı).' });
    }
    // html is sent when the user pastes the page source manually (sites that block bots)
    const product = await extractProduct(url, html, { fast: !!fast });
    res.json(product);
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Site 20 saniyede yanıt vermedi.' : err.message;
    res.status(500).json({ error: msg });
  }
});

// translates a section the user moved into specs/description by hand
app.post('/api/translate', async (req, res) => {
  const { fields, from, to } = req.body || {};
  if (!LANGS[to]) return res.status(400).json({ error: 'Geçersiz hedef dil.' });
  try {
    const empty = { name: '', shortDescription: '', category: '', descriptionHtml: '', specs: [] };
    const out = await translateFields({ ...empty, ...fields }, LANGS[from] ? from : '', to);
    res.json(applyGlossary(out, to, (await getSettings()).glossary));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const safeName = (s) => String(s || 'urun').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'urun';

// one image as 800×800 WebP (used for the previews and single downloads)
app.get('/api/image', async (req, res) => {
  const { url, ref, name, download } = req.query;
  if (!/^https?:\/\//i.test(url || '')) return res.status(400).send('Geçersiz görsel adresi');
  try {
    const webp = await toWebp(url, ref);
    res.type('image/webp');
    if (download) res.attachment(`${safeName(name)}.webp`);
    res.send(webp);
  } catch (err) {
    res.status(502).send(err.message);
  }
});

// all images as WebP in a single ZIP
app.post('/api/images.zip', async (req, res) => {
  const { urls, name, ref } = req.body || {};
  if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ error: 'Görsel yok.' });
  try {
    const { buffer, count, failed } = await webpZip(urls.filter((u) => /^https?:\/\//i.test(u)), safeName(name), ref);
    res.set('X-Converted', String(count)).set('X-Failed', String(failed));
    res.attachment(`${safeName(name)}_gorseller.zip`).type('application/zip').send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- saved products ----------

const fail = (res, err, status = 500) => res.status(err.code === 'ENOENT' ? 404 : status).json({ error: err.code === 'ENOENT' ? 'Kayıt bulunamadı.' : err.message });

app.get('/api/products', async (req, res) => {
  try {
    res.json(await listProducts());
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    res.json(await getProduct(req.params.id));
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/products', async (req, res) => {
  const { id, record, state } = req.body || {};
  if (!record?.languages) return res.status(400).json({ error: 'Kaydedilecek ürün yok.' });
  try {
    res.json(await saveProduct({ id, record, state }));
  } catch (err) {
    fail(res, err, 400);
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await deleteProduct(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 400);
  }
});

// ---------- export (WooCommerce / Shopify / general CSV / JSON) ----------

app.post('/api/export', async (req, res) => {
  const { format = 'csv', lang = 'tr', ids, records } = req.body || {};
  if (!['csv', 'woocommerce', 'shopify', 'json'].includes(format)) return res.status(400).json({ error: 'Bilinmeyen biçim.' });
  if (!LANGS[lang]) return res.status(400).json({ error: 'Geçersiz dil.' });
  try {
    const list = Array.isArray(records) && records.length ? records : await Promise.all((ids || []).map(async (id) => (await getProduct(id)).record));
    if (!list.length) return res.status(400).json({ error: 'Dışa aktarılacak ürün yok.' });
    const file = exportFile(format, list, lang);
    res.attachment(file.name).type(file.type).send(file.body);
  } catch (err) {
    fail(res, err);
  }
});

// ---------- settings (glossary, fixed texts) ----------

app.get('/api/settings', async (req, res) => res.json(await getSettings()));

app.put('/api/settings', async (req, res) => {
  try {
    res.json(await saveSettings(req.body));
  } catch (err) {
    fail(res, err);
  }
});

// ---------- bulk ----------

app.post('/api/bulk', (req, res) => {
  const { urls, fast } = req.body || {};
  try {
    res.json(startBulk(Array.isArray(urls) ? urls : String(urls || '').split(/\s+/), { fast: !!fast }));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.get('/api/bulk', (req, res) => res.json(bulkStatus()));

app.post('/api/bulk/stop', (req, res) => res.json(stopBulk()));

app.listen(PORT, () => {
  console.log(`Ürün Aktarıcı çalışıyor: http://localhost:${PORT}`);
  console.log(`Çeviri: ${provider === 'claude' ? 'Claude (ANTHROPIC_API_KEY)' : 'Google Çeviri (anahtarsız)'}`);
});
