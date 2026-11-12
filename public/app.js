const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const form = $('#form');
const statusEl = $('#status');
const result = $('#result');
const preview = $('#descPreview');
const descHtml = $('#descHtml');
const descText = $('#descText');
const specRows = $('#specRows');

let product = null;
let activeTab = 'preview';

function setStatus(type, msg) {
  statusEl.hidden = !msg;
  statusEl.className = `status ${type}`;
  statusEl.textContent = msg || '';
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d|tr|div)>/gi, '$&\n');
  return div.textContent.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// ---------- fetch ----------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#url').value.trim();
  const html = $('#html').value.trim();
  const btn = $('#go');
  btn.disabled = true;
  btn.textContent = 'Getiriliyor…';
  setStatus('load', 'Sayfa okunuyor…');
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, html: html || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');
    product = data;
    render();
    const missing = [!data.sku && 'stok kodu', !data.descriptionText && 'açıklama', !data.specs.length && 'özellik tablosu'].filter(Boolean);
    setStatus(missing.length ? 'err' : 'ok', missing.length ? `Bulunamayanlar: ${missing.join(', ')}. Elle doldurabilirsin.` : 'Tüm bilgiler bulundu.');
  } catch (err) {
    setStatus('err', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bilgileri Getir';
  }
});

// ---------- render ----------

function render() {
  result.hidden = false;
  for (const input of $$('[data-f]')) input.value = product[input.dataset.f] || '';

  const s = product.sources;
  const found = [s.jsonLd && 'yapısal veri (JSON-LD)', s.microdata && 'microdata', s.shopify && 'Shopify'].filter(Boolean);
  $('#sources').textContent = found.length ? `Kaynak: ${found.join(', ')} + sayfa içeriği` : 'Kaynak: sayfa içeriği';

  preview.innerHTML = product.descriptionHtml;
  descHtml.value = product.descriptionHtml;
  descText.value = product.descriptionText;

  specRows.innerHTML = '';
  for (const g of product.specs) {
    if (product.specs.length > 1 && g.title) addGroupRow(g.title);
    for (const r of g.rows) addSpecRow(r.key, r.value);
  }
  $('#noSpecs').hidden = product.specs.length > 0;

  const imgs = $('#images');
  imgs.innerHTML = product.images.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(u)}" loading="lazy" alt=""></a>`).join('');
  $('#imgCount').textContent = product.images.length ? `(${product.images.length})` : '— bulunamadı';
}

function addGroupRow(title) {
  const tr = document.createElement('tr');
  tr.className = 'group';
  tr.innerHTML = `<td colspan="2"><input class="group-title" value="${escapeHtml(title)}"></td><td><button type="button" class="del" title="Sil">×</button></td>`;
  specRows.append(tr);
}

function addSpecRow(key = '', value = '') {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><input class="k" value="${escapeHtml(key)}"></td><td><input class="v" value="${escapeHtml(value)}"></td><td><button type="button" class="del" title="Sil">×</button></td>`;
  specRows.append(tr);
  return tr;
}

specRows.addEventListener('click', (e) => {
  if (e.target.classList.contains('del')) e.target.closest('tr').remove();
});
$('#addRow').addEventListener('click', () => {
  addSpecRow().querySelector('input').focus();
  $('#noSpecs').hidden = true;
});

// ---------- description tabs (kept in sync) ----------

function syncDescFrom(tab) {
  if (tab === 'preview') descHtml.value = preview.innerHTML;
  if (tab === 'html') preview.innerHTML = descHtml.value;
  if (tab === 'text') return; // plain text is a separate, independent edit
  descText.value = htmlToText(descHtml.value);
}

for (const t of $$('.tab')) {
  t.addEventListener('click', () => {
    syncDescFrom(activeTab);
    activeTab = t.dataset.tab;
    for (const x of $$('.tab')) x.classList.toggle('active', x === t);
    preview.hidden = activeTab !== 'preview';
    descHtml.hidden = activeTab !== 'html';
    descText.hidden = activeTab !== 'text';
  });
}

// ---------- collect current (edited) values ----------

function collect() {
  syncDescFrom(activeTab);
  const data = { url: product.url };
  for (const input of $$('[data-f]')) data[input.dataset.f] = input.value.trim();
  data.descriptionHtml = descHtml.value.trim();
  data.descriptionText = descText.value.trim();

  const specs = [];
  let group = { title: '', rows: [] };
  for (const tr of specRows.children) {
    if (tr.classList.contains('group')) {
      if (group.rows.length) specs.push(group);
      group = { title: tr.querySelector('input').value.trim(), rows: [] };
    } else {
      const key = tr.querySelector('.k').value.trim();
      const value = tr.querySelector('.v').value.trim();
      if (key || value) group.rows.push({ key, value });
    }
  }
  if (group.rows.length) specs.push(group);
  data.specs = specs;
  data.images = product.images;
  return data;
}

function specsHtml(specs) {
  const rows = specs.flatMap((g) => [
    ...(specs.length > 1 && g.title ? [`  <tr><th colspan="2">${escapeHtml(g.title)}</th></tr>`] : []),
    ...g.rows.map((r) => `  <tr><td>${escapeHtml(r.key)}</td><td>${escapeHtml(r.value)}</td></tr>`),
  ]);
  return `<table>\n${rows.join('\n')}\n</table>`;
}

const specsText = (specs) => specs.flatMap((g) => g.rows.map((r) => `${r.key}: ${r.value}`)).join('\n');

// ---------- copy ----------

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn || !product) return;
  const d = collect();
  const text = {
    shortDescription: d.shortDescription,
    description: activeTab === 'text' ? d.descriptionText : d.descriptionHtml,
    specsHtml: specsHtml(d.specs),
    specsText: specsText(d.specs),
    images: d.images.join('\n'),
  }[btn.dataset.copy];
  await navigator.clipboard.writeText(text || '');
  toast('Kopyalandı');
});

// ---------- export ----------

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fileBase = (d) => (d.sku || d.name || 'urun').replace(/[^\w\-]+/g, '_').slice(0, 60);

function csvCell(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

for (const btn of $$('[data-export]')) {
  btn.addEventListener('click', () => {
    if (!product) return;
    const d = collect();
    if (btn.dataset.export === 'json') {
      download(`${fileBase(d)}.json`, JSON.stringify(d, null, 2), 'application/json');
      return;
    }
    const cols = {
      'Ürün Adı': d.name,
      'Stok Kodu': d.sku,
      Barkod: d.barcode,
      Marka: d.brand,
      Fiyat: d.price,
      'Para Birimi': d.currency,
      Kategori: d.category,
      'Kısa Açıklama': d.shortDescription,
      'Açıklama (HTML)': d.descriptionHtml,
      'Özellikler (HTML)': d.specs.length ? specsHtml(d.specs) : '',
      Görseller: d.images.join(','),
      Kaynak: d.url,
    };
    for (const g of d.specs) for (const r of g.rows) cols[r.key] ??= r.value;
    const csv = [Object.keys(cols), Object.values(cols)].map((row) => row.map(csvCell).join(';')).join('\r\n');
    // BOM so Excel opens Turkish characters correctly
    download(`${fileBase(d)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  });
}
