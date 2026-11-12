import express from 'express';
import { fileURLToPath } from 'node:url';
import { extractProduct, parseProduct } from './extract.js';

const PORT = process.env.PORT || 4000;
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

app.post('/api/extract', async (req, res) => {
  const { url, html } = req.body || {};
  try {
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Geçerli bir ürün linki girin (http:// veya https:// ile başlamalı).' });
    }
    // html is sent when the user pastes the page source manually (sites that block bots)
    const product = html ? await parseProduct(html, url) : await extractProduct(url);
    res.json(product);
  } catch (err) {
    const msg = err.name === 'TimeoutError' ? 'Site 20 saniyede yanıt vermedi.' : err.message;
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Ürün Aktarıcı çalışıyor: http://localhost:${PORT}`);
});
