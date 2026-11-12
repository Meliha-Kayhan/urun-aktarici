import express from 'express';
import { fileURLToPath } from 'node:url';
import { extractProduct } from './extract.js';
import { LANGS, provider, translateFields } from './translate.js';
import { toWebp, webpZip } from './images.js';

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
    res.json(await translateFields({ ...empty, ...fields }, LANGS[from] ? from : '', to));
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

app.listen(PORT, () => {
  console.log(`Ürün Aktarıcı çalışıyor: http://localhost:${PORT}`);
  console.log(`Çeviri: ${provider === 'claude' ? 'Claude (ANTHROPIC_API_KEY)' : 'Google Çeviri (anahtarsız)'}`);
});
