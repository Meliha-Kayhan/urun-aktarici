const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const LANGS = { tr: 'TR', en: 'EN', nl: 'NL' };
const SOURCE_LABEL = {
  original: 'orijinal',
  site: 'sitenin kendi sayfası',
  google: 'Google çeviri',
  claude: 'Claude çeviri',
  error: 'çevrilemedi',
};

const form = $('#form');
const statusEl = $('#status');
const result = $('#result');
const preview = $('#descPreview');
const descHtml = $('#descHtml');
const descText = $('#descText');
const specRows = $('#specRows');

let product = null;
let lang = 'tr';
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
  setStatus('load', 'Sayfa okunuyor ve 3 dile çevriliyor… (10-30 sn sürebilir)');
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, html: html || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');
    product = data;
    lang = data.translations[data.lang] ? data.lang : 'tr';
    render();
    const missing = [!data.sku && 'stok kodu', !data.descriptionText && 'açıklama', !data.specs.length && 'özellik tablosu'].filter(Boolean);
    const failed = Object.entries(data.translations).filter(([, t]) => t.source === 'error').map(([l]) => LANGS[l]);
    const notes = [];
    if (missing.length) notes.push(`Bulunamayanlar: ${missing.join(', ')}. Elle doldurabilirsin.`);
    if (failed.length) notes.push(`Çevrilemeyen diller: ${failed.join(', ')}.`);
    setStatus(notes.length ? 'err' : 'ok', notes.join(' ') || 'Tüm bilgiler bulundu, 3 dil hazır.');
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

  const imgs = $('#images');
  imgs.innerHTML = product.images.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(u)}" loading="lazy" alt=""></a>`).join('');
  $('#imgCount').textContent = product.images.length ? `(${product.images.length})` : '— bulunamadı';

  $('#docs').innerHTML = product.documents
    .map(
      (d) =>
        `<li><span class="doc-group">${escapeHtml(d.group || '')}</span><a href="${escapeHtml(d.url)}" target="_blank" rel="noreferrer">${escapeHtml(d.title)}</a>` +
        (d.title !== d.file ? `<span class="doc-file">${escapeHtml(d.file)}</span>` : '') +
        '</li>'
    )
    .join('');
  $('#docCount').textContent = product.documents.length ? `(${product.documents.length})` : '— bulunamadı';

  renderLangTabs();
  loadLang(lang);
}

function renderLangTabs() {
  $('#langs').innerHTML = Object.entries(LANGS)
    .map(([code, label]) => {
      const src = product.translations[code]?.source;
      return `<button type="button" class="lang${code === lang ? ' active' : ''}" data-lang="${code}">${label}<span class="badge ${src}">${SOURCE_LABEL[src] || ''}</span></button>`;
    })
    .join('');
}

$('#langs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-lang]');
  if (!btn || btn.dataset.lang === lang) return;
  saveLang();
  lang = btn.dataset.lang;
  renderLangTabs();
  loadLang(lang);
});

function loadLang(code) {
  const t = product.translations[code];
  for (const input of $$('[data-t]')) input.value = t[input.dataset.t] || '';
  preview.innerHTML = t.descriptionHtml;
  descHtml.value = t.descriptionHtml;
  descText.value = t.descriptionText;

  specRows.innerHTML = '';
  for (const g of t.specs) {
    if (t.specs.length > 1 && g.title) addGroupRow(g.title);
    for (const r of g.rows) addSpecRow(r.key, r.value);
  }
  $('#noSpecs').hidden = t.specs.length > 0;

  const note = $('#langNote');
  note.className = 'lang-note' + (t.source === 'error' ? ' error' : '');
  note.innerHTML =
    t.source === 'error' ? `Çeviri yapılamadı: ${escapeHtml(t.error)}. Aşağıda orijinal metin var.`
    : t.source === 'site' ? `Metin sitenin bu dildeki sayfasından alındı: <a href="${escapeHtml(t.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(t.sourceUrl)}</a>`
    : t.source === 'original' ? 'Sayfanın kendi dili.'
    : 'Makine çevirisi — yayınlamadan önce göz gezdir.';
}

// reads the current language's (possibly edited) fields back into state
function saveLang() {
  syncDescFrom(activeTab);
  const t = product.translations[lang];
  for (const input of $$('[data-t]')) t[input.dataset.t] = input.value.trim();
  t.descriptionHtml = descHtml.value.trim();
  t.descriptionText = descText.value.trim();
  t.specs = readSpecs();
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

function readSpecs() {
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
  return specs;
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
  saveLang();
  const data = { url: product.url };
  for (const input of $$('[data-f]')) data[input.dataset.f] = input.value.trim();
  data.images = product.images;
  data.documents = product.documents;
  data.languages = {};
  for (const code of Object.keys(LANGS)) {
    const { name, category, shortDescription, descriptionHtml, descriptionText, specs } = product.translations[code];
    data.languages[code] = { name, category, shortDescription, descriptionHtml, descriptionText, specs };
  }
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

// ---------- copy (current language) ----------

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn || !product) return;
  const d = collect();
  const t = d.languages[lang];
  const text = {
    shortDescription: t.shortDescription,
    description: activeTab === 'text' ? t.descriptionText : t.descriptionHtml,
    specsHtml: specsHtml(t.specs),
    specsText: specsText(t.specs),
    images: d.images.join('\n'),
    documents: d.documents.map((x) => `${x.title}: ${x.url}`).join('\n'),
  }[btn.dataset.copy];
  await navigator.clipboard.writeText(text || '');
  toast(`Kopyalandı (${LANGS[lang]})`);
});

// ---------- export (all languages) ----------

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fileBase = (d) => (d.sku || d.languages.tr.name || 'urun').replace(/[^\w\-]+/g, '_').slice(0, 60);

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
      'Stok Kodu': d.sku,
      Barkod: d.barcode,
      Marka: d.brand,
      Fiyat: d.price,
      'Para Birimi': d.currency,
    };
    for (const [code, label] of Object.entries(LANGS)) {
      const t = d.languages[code];
      cols[`Ürün Adı (${label})`] = t.name;
      cols[`Kategori (${label})`] = t.category;
      cols[`Kısa Açıklama (${label})`] = t.shortDescription;
      cols[`Açıklama HTML (${label})`] = t.descriptionHtml;
      cols[`Özellikler HTML (${label})`] = t.specs.length ? specsHtml(t.specs) : '';
    }
    cols['Görseller'] = d.images.join(',');
    cols['Belgeler'] = d.documents.map((x) => x.url).join(',');
    cols['Kaynak'] = d.url;
    const csv = [Object.keys(cols), Object.values(cols)].map((row) => row.map(csvCell).join(';')).join('\r\n');
    // BOM so Excel opens Turkish characters correctly
    download(`${fileBase(d)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  });
}
