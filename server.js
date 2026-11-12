import express from 'express';
import { fileURLToPath } from 'node:url';
import { extractProduct } from './extract.js';
import { LANGS, provider, translateFields } from './translate.js';

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

app.listen(PORT, () => {
  console.log(`Ürün Aktarıcı çalışıyor: http://localhost:${PORT}`);
  console.log(`Çeviri: ${provider === 'claude' ? 'Claude (ANTHROPIC_API_KEY)' : 'Google Çeviri (anahtarsız)'}`);
});
