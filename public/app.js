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
let currentId = null; // id of the saved copy of the product on screen
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
  const fast = $('#fast').checked;
  setStatus('load', fast || html ? 'Sayfa okunuyor ve 3 dile çevriliyor… (10-30 sn)' : 'Sayfa tarayıcıda açılıyor, sekmeler geziliyor ve 3 dile çevriliyor… (20-60 sn)');
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, html: html || undefined, fast }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');
    product = data;
    currentId = null;
    lang = data.translations[data.lang] ? data.lang : 'tr';
    render();
    await saveCurrent(true);
    const missing = [!data.sku && 'stok kodu', !data.descriptionText && 'açıklama', !data.specs.length && 'özellik tablosu'].filter(Boolean);
    const failed = Object.entries(data.translations).filter(([, t]) => t.source === 'error').map(([l]) => LANGS[l]);
    const notes = [];
    if (data.browserError) notes.push(`Tarayıcı açılamadı (${data.browserError}), hızlı moda geçildi.`);
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
  const mode = { browser: 'tarayıcıda açıldı', fast: 'hızlı mod', pasted: 'yapıştırılan kaynak' }[product.mode] || '';
  $('#sources').textContent = (found.length ? `Kaynak: ${found.join(', ')} + sayfa içeriği` : 'Kaynak: sayfa içeriği') + (mode ? ` · ${mode}` : '');

  renderOriginal();
  renderSections();
  renderVariants();
  renderImages();

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

// ---------- images (800×800 WebP, converted by the server) ----------

const imageBase = () => ($('[data-f="sku"]').value.trim() || product.translations.tr?.name || 'urun').replace(/[^\w\-]+/g, '_').slice(0, 60);

function webpUrl(src, i, download) {
  const q = new URLSearchParams({ url: src, ref: product.url, name: `${imageBase()}_${i + 1}` });
  if (download) q.set('download', '1');
  return `/api/image?${q}`;
}

// images the user removed with × stay out of the ZIP and the exports
const activeImages = () => product.images.filter((im) => !im.removed);

function renderImages() {
  $('#images').innerHTML = product.images
    .map((im, i) => {
      const size = `${im.width}×${im.height}`;
      return `<div class="img-tile${im.removed ? ' removed' : ''}" data-i="${i}">
        <a class="img" href="${escapeHtml(webpUrl(im.url, i))}" target="_blank" rel="noreferrer"><img src="${escapeHtml(webpUrl(im.url, i))}" loading="lazy" alt=""></a>
        <button type="button" class="img-x" title="${im.removed ? 'Geri al' : 'Kaldır'}">${im.removed ? '↺' : '×'}</button>
        <span class="img-size${im.upscaled ? ' small' : ''}" title="${im.upscaled ? 'Kaynak 800 pikselden küçük; büyütüldüğü için net olmayabilir' : 'Kaynak boyutu'}">${im.upscaled ? '⚠ ' : ''}${size}</span>
        <a class="img-dl" href="${escapeHtml(webpUrl(im.url, i, true))}">WebP indir</a>
      </div>`;
    })
    .join('');
  const n = activeImages().length;
  $('#imgCount').textContent = product.images.length ? `(${n}${n !== product.images.length ? ` / ${product.images.length}` : ''})` : '— bulunamadı';
  // a source that can't be converted shows why instead of a broken image
  for (const img of $$('#images img')) {
    img.addEventListener('error', () => {
      const tile = img.closest('.img-tile');
      tile.classList.add('failed');
      img.replaceWith('Dönüştürülemedi');
      tile.querySelector('.img-dl')?.remove();
    });
  }
}

$('#images').addEventListener('click', (e) => {
  const x = e.target.closest('.img-x');
  if (!x) return;
  const im = product.images[Number(x.closest('.img-tile').dataset.i)];
  im.removed = !im.removed;
  renderImages();
});

$('#imagesZip').addEventListener('click', async () => {
  if (!product || !activeImages().length) return toast('Görsel yok');
  const btn = $('#imagesZip');
  btn.disabled = true;
  btn.textContent = 'Hazırlanıyor…';
  try {
    const res = await fetch('/api/images.zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: activeImages().map((im) => im.url), name: imageBase(), ref: product.url }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    download(`${imageBase()}_gorseller.zip`, await res.blob(), 'application/zip');
    const failed = Number(res.headers.get('X-Failed') || 0);
    toast(failed ? `${res.headers.get('X-Converted')} görsel indirildi, ${failed} tanesi dönüştürülemedi` : 'Görseller indirildi');
  } catch (err) {
    setStatus('err', `ZIP hazırlanamadı: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tümünü indir (ZIP)';
  }
});

// ---------- all page sections ----------

const KIND_LABEL = { specs: 'özellik listesi', text: 'metin', other: 'diğer' };
const USED_LABEL = { specs: 'özelliklerde', description: 'açıklamada', short: 'kısa açıklamada' };
const TARGET_LABEL = { specs: 'özelliklere', description: 'açıklamaya', short: 'kısa açıklamaya' };

function renderSections() {
  const list = product.sections || [];
  $('#secCount').textContent = `(${list.length})`;
  $('#sections').innerHTML = list
    .map(
      (s) => `<li class="sec" data-id="${s.id}">
        <div class="sec-head">
          <span class="sec-title${s.title ? '' : ' untitled'}">${escapeHtml(s.title || 'başlıksız')}</span>
          <span class="badge kind-${s.kind}">${KIND_LABEL[s.kind]}${s.rows.length ? ` · ${s.rows.length} satır` : ''}</span>
          ${s.usedAs ? `<span class="badge used">${USED_LABEL[s.usedAs]}</span>` : ''}
          <div class="sec-actions">
            <button type="button" data-sec="specs" ${s.rows.length ? '' : 'disabled title="Bu bölümde özellik satırı yok"'}>Özelliklere ekle</button>
            <button type="button" data-sec="desc">Açıklamaya ekle</button>
            <button type="button" data-sec="short">Kısa açıklamaya ekle</button>
            <button type="button" data-sec="toggle">Göster</button>
          </div>
        </div>
        <div class="sec-preview">${escapeHtml(s.text.replace(/\n/g, ' · ').slice(0, 220))}</div>
        <div class="sec-body" hidden></div>
      </li>`
    )
    .join('');
}

$('#sections').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-sec]');
  if (!btn) return;
  const li = btn.closest('.sec');
  const s = product.sections[Number(li.dataset.id)];
  if (btn.dataset.sec === 'toggle') {
    const body = li.querySelector('.sec-body');
    if (!body.innerHTML) body.innerHTML = s.html;
    body.hidden = !body.hidden;
    btn.textContent = body.hidden ? 'Göster' : 'Gizle';
    return;
  }
  for (const b of li.querySelectorAll('button')) b.disabled = true;
  try {
    await addSection(s, { specs: 'specs', desc: 'description', short: 'short' }[btn.dataset.sec]);
  } catch (err) {
    setStatus('err', `Bölüm eklenemedi: ${err.message}`);
    renderSections();
  }
});

// Adds a section to every language: as-is for the page's own language,
// translated for the others.
async function addSection(s, target) {
  saveLang();
  // the short description is plain text, so the section goes in as one flat line
  const part =
    target === 'specs'
      ? { specs: [{ title: s.title, rows: s.rows }] }
      : target === 'short'
        ? { shortDescription: s.text.replace(/\s*\n+\s*/g, ' ').trim() }
        : { descriptionHtml: (s.title ? `<h3>${escapeHtml(s.title)}</h3>\n` : '') + s.html };
  setStatus('load', `"${s.title || 'başlıksız'}" ekleniyor ve çevriliyor…`);

  // one language at a time: the free translator rate-limits bursts
  const results = [];
  for (const code of Object.keys(LANGS)) {
    if (code === product.lang) {
      results.push([code, part]);
      continue;
    }
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: part, from: product.lang, to: code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'çeviri hatası');
    results.push([code, data]);
  }

  for (const [code, data] of results) {
    const t = product.translations[code];
    if (target === 'specs') t.specs = [...t.specs, ...data.specs];
    else if (target === 'short') t.shortDescription = [t.shortDescription, data.shortDescription].filter(Boolean).join(' ');
    else {
      t.descriptionHtml = [t.descriptionHtml, data.descriptionHtml].filter(Boolean).join('\n');
      t.descriptionText = htmlToText(t.descriptionHtml);
    }
  }
  s.usedAs = target;
  loadLang(lang);
  renderSections();
  setStatus('ok', `"${s.title || 'başlıksız'}" ${TARGET_LABEL[target]} eklendi (TR, EN, NL).`);
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
  if (tab === 'text' || tab === 'orig') return; // plain text is a separate edit; the original is read-only
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
    $('#descOrigWrap').hidden = activeTab !== 'orig';
    if (activeTab === 'orig' && product) $('#descOrig').innerHTML = product.originalDescriptionHtml || '<p class="muted">Yok</p>';
  });
}

// ---------- collect current (edited) values ----------

function collect() {
  saveLang();
  const data = { url: product.url };
  for (const input of $$('[data-f]')) data[input.dataset.f] = input.value.trim();
  data.images = activeImages().map((im) => im.url);
  data.documents = product.documents;
  data.variants = readVariants();
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
  a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

const fileBase = (d) => (d.sku || d.languages.tr.name || 'urun').replace(/[^\w\-]+/g, '_').slice(0, 60);

// Just the table, so it can be pasted into a store editor as-is; the charset
// line keeps Turkish characters intact when the file is opened in a browser.
$('#specsDownload').addEventListener('click', () => {
  if (!product) return;
  const d = collect();
  const specs = d.languages[lang].specs;
  if (!specs.length) return toast('Özellik tablosu boş');
  download(`${fileBase(d)}_ozellikler_${lang}.html`, `<meta charset="utf-8">\n${specsHtml(specs)}\n`, 'text/html;charset=utf-8');
  toast(`İndirildi (${LANGS[lang]})`);
});

// ---------- save ----------

async function saveCurrent(silent = false) {
  if (!product) return;
  const record = collect();
  product.variants = record.variants;
  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: currentId, record, state: product }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentId = data.id;
    $('#save').textContent = 'Kaydedildi ✓';
    clearTimeout(saveCurrent.timer);
    saveCurrent.timer = setTimeout(() => ($('#save').textContent = 'Kaydet'), 2500);
    if (!silent) toast('Kaydedildi');
    window.refreshLibraryCount?.();
    return record;
  } catch (err) {
    setStatus('err', `Kaydedilemedi: ${err.message}`);
  }
}

$('#save').addEventListener('click', () => saveCurrent());

// ---------- export (WooCommerce / Shopify / Excel / JSON, built by the server) ----------

async function downloadExport(body) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Dışa aktarılamadı');
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'urunler.csv';
  download(decodeURIComponent(name), await res.blob(), res.headers.get('Content-Type'));
}

$('#exportBtn').addEventListener('click', async () => {
  if (!product) return;
  const record = (await saveCurrent(true)) || collect();
  try {
    await downloadExport({ format: $('#exportFormat').value, lang: $('#exportLang').value, records: [record] });
  } catch (err) {
    setStatus('err', err.message);
  }
});

// ---------- original page (new tab, or a screenshot inside the app) ----------

let shotUrl = null; // object URL of the screenshot on display

function renderOriginal() {
  $('#origOpen').href = product.url;
  try {
    $('#origHost').textContent = new URL(product.url).hostname.replace(/^www\./, '');
  } catch {
    $('#origHost').textContent = '';
  }
  // a different product: forget the previous screenshot
  if (shotUrl) URL.revokeObjectURL(shotUrl);
  shotUrl = null;
  $('#origView').hidden = true;
  $('#origView').innerHTML = '';
  $('#origShot').textContent = 'Görüntüsünü göster';
  $('#origShot').disabled = false;
}

$('#origShot').addEventListener('click', async () => {
  const view = $('#origView');
  const btn = $('#origShot');
  if (shotUrl) {
    view.hidden = !view.hidden;
    btn.textContent = view.hidden ? 'Görüntüsünü göster' : 'Görüntüyü gizle';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Görüntü alınıyor… (10-30 sn)';
  try {
    const res = await fetch(`/api/snapshot?${new URLSearchParams({ url: product.url })}`);
    if (!res.ok) throw new Error(await res.text());
    shotUrl = URL.createObjectURL(await res.blob());
    view.innerHTML = `<img src="${shotUrl}" alt="Orijinal sayfanın görüntüsü">`;
    view.hidden = false;
    btn.textContent = 'Görüntüyü gizle';
  } catch (err) {
    view.innerHTML = `<p class="orig-err">Görüntü alınamadı: ${escapeHtml(err.message)}. "Yeni sekmede aç" ile sayfaya bakabilirsin.</p>`;
    view.hidden = false;
    btn.textContent = 'Tekrar dene';
  } finally {
    btn.disabled = false;
  }
});

// ---------- variants ----------

function renderVariants() {
  const vs = product.variants || [];
  $('#variantsBlock').hidden = !vs.length;
  if (!vs.length) return;
  const opts = [...new Set(vs.flatMap((v) => Object.keys(v.options || {})))];
  $('#varCount').textContent = `(${vs.length})`;
  $('#varHead').innerHTML = `<tr>${opts.map((o) => `<th>${escapeHtml(o)}</th>`).join('')}<th>Stok kodu</th><th>Fiyat</th><th>Barkod</th><th>Stokta</th></tr>`;
  $('#varRows').innerHTML = vs
    .map(
      (v, i) => `<tr data-i="${i}">${opts.map((o) => `<td class="opt-cell">${escapeHtml(v.options?.[o] || '')}</td>`).join('')}
        <td><input class="v-sku" value="${escapeHtml(v.sku || '')}"></td>
        <td><input class="v-price" value="${escapeHtml(v.price || '')}"></td>
        <td><input class="v-barcode" value="${escapeHtml(v.barcode || '')}"></td>
        <td class="center"><input type="checkbox" class="v-avail" ${v.available === false ? '' : 'checked'}></td></tr>`
    )
    .join('');
}

function readVariants() {
  return (product.variants || []).map((v, i) => {
    const tr = $(`#varRows tr[data-i="${i}"]`);
    if (!tr) return v;
    return {
      ...v,
      sku: tr.querySelector('.v-sku').value.trim(),
      price: tr.querySelector('.v-price').value.trim(),
      barcode: tr.querySelector('.v-barcode').value.trim(),
      available: tr.querySelector('.v-avail').checked,
    };
  });
}

// ---------- open a saved product ----------

async function openSaved(id) {
  const res = await fetch(`/api/products/${encodeURIComponent(id)}`);
  const saved = await res.json();
  if (!res.ok) throw new Error(saved.error);
  product = saved.state;
  currentId = saved.id;
  lang = product.translations[product.lang] ? product.lang : 'tr';
  $('#url').value = product.url || '';
  render();
  setStatus('ok', `Kayıtlı ürün açıldı (${new Date(saved.savedAt).toLocaleString('tr-TR')}). Değişiklikleri "Kaydet" ile saklayabilirsin.`);
}
