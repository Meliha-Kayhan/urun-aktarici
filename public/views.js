// Bulk, saved products and settings screens. Shares helpers and state with
// app.js ($, escapeHtml, toast, setStatus, download, downloadExport, openSaved).

// ---------- navigation ----------

const VIEWS = { urun: 'product', toplu: 'bulk', kayitlar: 'library', ayarlar: 'settings' };

function showView(name) {
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  for (const a of $$('#nav a')) a.classList.toggle('active', a.dataset.view === name);
  if (name === 'library') loadLibrary();
  if (name === 'settings') loadSettings();
  if (name === 'bulk') pollBulk();
}

window.addEventListener('hashchange', () => showView(VIEWS[location.hash.slice(1)] || 'product'));

// ---------- saved products ----------

let library = [];
const selected = new Set();

async function refreshLibraryCount() {
  try {
    library = await (await fetch('/api/products')).json();
    $('#libCount').textContent = library.length ? library.length : '';
  } catch {
    /* server busy; the count just stays as it was */
  }
}

async function loadLibrary() {
  await refreshLibraryCount();
  renderLibrary();
}

const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function renderLibrary() {
  const q = $('#libSearch').value.trim().toLocaleLowerCase('tr');
  const rows = library.filter((p) => !q || `${p.name} ${p.sku} ${p.url}`.toLocaleLowerCase('tr').includes(q));
  for (const id of [...selected]) if (!library.some((p) => p.id === id)) selected.delete(id);
  $('#libEmpty').hidden = library.length > 0;
  $('#libRows').innerHTML = rows
    .map(
      (p) => `<tr data-id="${escapeHtml(p.id)}">
        <td><input type="checkbox" class="lib-sel" ${selected.has(p.id) ? 'checked' : ''}></td>
        <td>${p.image ? `<img class="lib-thumb" src="/api/image?${new URLSearchParams({ url: p.image, ref: p.url })}" loading="lazy" alt="">` : ''}</td>
        <td><a href="#urun" class="lib-open">${escapeHtml(p.name || '(adsız)')}</a>
          <div class="muted small">${p.images} görsel${p.variants ? ` · ${p.variants} varyant` : ''}</div></td>
        <td>${escapeHtml(p.sku || '')}</td>
        <td><a href="${escapeHtml(p.url)}" target="_blank" rel="noreferrer" class="muted">${escapeHtml(host(p.url))}</a></td>
        <td class="muted small">${new Date(p.savedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
        <td><button type="button" class="lib-del del" title="Sil">×</button></td>
      </tr>`
    )
    .join('');
  $('#libAll').checked = rows.length > 0 && rows.every((p) => selected.has(p.id));
  updateLibButtons();
}

function updateLibButtons() {
  $('#libExport').textContent = selected.size ? `Seçilenleri dışa aktar (${selected.size})` : 'Seçilenleri dışa aktar';
  $('#libExport').disabled = $('#libDelete').disabled = !selected.size;
}

$('#libSearch').addEventListener('input', renderLibrary);

$('#libAll').addEventListener('change', (e) => {
  for (const tr of $$('#libRows tr')) {
    if (e.target.checked) selected.add(tr.dataset.id);
    else selected.delete(tr.dataset.id);
  }
  renderLibrary();
});

$('#libRows').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.classList.contains('lib-sel')) {
    if (e.target.checked) selected.add(id);
    else selected.delete(id);
    updateLibButtons();
  } else if (e.target.closest('.lib-open')) {
    e.preventDefault();
    try {
      await openSaved(id);
      location.hash = 'urun';
    } catch (err) {
      toast(err.message);
    }
  } else if (e.target.closest('.lib-del')) {
    const p = library.find((x) => x.id === id);
    if (!confirm(`"${p?.name || id}" silinsin mi? Bu geri alınamaz.`)) return;
    await fetch(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (currentId === id) currentId = null;
    selected.delete(id);
    loadLibrary();
  }
});

$('#libExport').addEventListener('click', async () => {
  if (!selected.size) return;
  const btn = $('#libExport');
  btn.disabled = true;
  try {
    await downloadExport({ format: $('#libFormat').value, lang: $('#libLang').value, ids: [...selected] });
  } catch (err) {
    toast(err.message);
  } finally {
    updateLibButtons();
  }
});

$('#libDelete').addEventListener('click', async () => {
  if (!selected.size || !confirm(`${selected.size} ürün silinsin mi? Bu geri alınamaz.`)) return;
  for (const id of selected) {
    await fetch(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (currentId === id) currentId = null;
  }
  selected.clear();
  loadLibrary();
});

// ---------- bulk ----------

const BULK_STATUS = { pending: 'Sırada', running: 'İşleniyor…', done: 'Tamam', error: 'Hata', skipped: 'Durduruldu' };
let bulkTimer = null;

function renderBulk(job) {
  const running = !!job?.running;
  $('#bulkStart').disabled = running;
  $('#bulkStop').hidden = !running;
  if (!job) return;
  const n = (s) => job.items.filter((i) => i.status === s).length;
  const done = n('done');
  const total = job.items.length;
  const summary = $('#bulkSummary');
  summary.hidden = false;
  summary.className = `status ${running ? 'load' : n('error') ? 'err' : 'ok'}`;
  summary.textContent = running
    ? `İşleniyor: ${done + n('error')} / ${total} tamamlandı${job.stopRequested ? ' — durduruluyor (mevcut ürün bitince)' : ''}`
    : `Bitti: ${done} ürün kaydedildi${n('error') ? `, ${n('error')} hata` : ''}${n('skipped') ? `, ${n('skipped')} durduruldu` : ''}.`;
  if (job.ignored) summary.textContent += ` ${job.ignored} satır link olmadığı için atlandı.`;
  $('#bulkList').innerHTML = job.items
    .map(
      (it) => `<li class="bulk-item ${it.status}">
        <span class="bulk-status">${BULK_STATUS[it.status]}</span>
        <span class="bulk-main">
          ${it.status === 'done' ? `<a href="#urun" class="bulk-open" data-id="${escapeHtml(it.id)}">${escapeHtml(it.name || it.url)}</a>` : `<span>${escapeHtml(it.url)}</span>`}
          ${it.sku ? `<span class="muted small">${escapeHtml(it.sku)}</span>` : ''}
          ${it.error ? `<span class="bulk-err">${escapeHtml(it.error)}</span>` : ''}
          ${it.warning ? `<span class="bulk-warn">${escapeHtml(it.warning)}</span>` : ''}
        </span>
        <span class="muted small">${it.seconds ? `${it.seconds} sn` : ''}</span>
      </li>`
    )
    .join('');
}

async function pollBulk() {
  clearTimeout(bulkTimer);
  try {
    const job = await (await fetch('/api/bulk')).json();
    renderBulk(job);
    if (job?.running) bulkTimer = setTimeout(pollBulk, 2000);
    else refreshLibraryCount();
  } catch {
    bulkTimer = setTimeout(pollBulk, 4000);
  }
}

$('#bulkStart').addEventListener('click', async () => {
  const urls = $('#bulkUrls').value.split(/\s+/).filter(Boolean);
  if (!urls.length) return toast('Önce linkleri yapıştır');
  const res = await fetch('/api/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, fast: $('#bulkFast').checked }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error);
  renderBulk(data);
  pollBulk();
});

$('#bulkStop').addEventListener('click', async () => {
  renderBulk(await (await fetch('/api/bulk/stop', { method: 'POST' })).json());
});

$('#bulkList').addEventListener('click', async (e) => {
  const a = e.target.closest('.bulk-open');
  if (!a) return;
  e.preventDefault();
  try {
    await openSaved(a.dataset.id);
    location.hash = 'urun';
  } catch (err) {
    toast(err.message);
  }
});

// ---------- settings ----------

const LANG_OPTIONS = [['*', 'Tümü'], ['tr', 'TR'], ['en', 'EN'], ['nl', 'NL']];

function glossRow(g = { lang: 'tr', find: '', replace: '' }) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><select class="g-lang">${LANG_OPTIONS.map(([v, l]) => `<option value="${v}" ${g.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
    <td><input class="g-find" value="${escapeHtml(g.find)}" placeholder="ör. Gofret"></td>
    <td><input class="g-replace" value="${escapeHtml(g.replace)}" placeholder="ör. Wafer"></td>
    <td><button type="button" class="del" title="Sil">×</button></td>`;
  $('#glossRows').append(tr);
  return tr;
}

async function loadSettings() {
  const s = await (await fetch('/api/settings')).json();
  $('#glossRows').innerHTML = '';
  (s.glossary.length ? s.glossary : [undefined]).forEach((g) => glossRow(g));
  $('#keepTerms').value = (s.keepTerms || []).join('\n');
  for (const l of ['tr', 'en', 'nl']) $(`#footer-${l}`).value = s.footers?.[l] || '';
}

$('#glossAdd').addEventListener('click', () => glossRow().querySelector('.g-find').focus());
$('#glossRows').addEventListener('click', (e) => {
  if (e.target.classList.contains('del')) e.target.closest('tr').remove();
});

$('#settingsSave').addEventListener('click', async () => {
  const glossary = [...$$('#glossRows tr')]
    .map((tr) => ({ lang: tr.querySelector('.g-lang').value, find: tr.querySelector('.g-find').value.trim(), replace: tr.querySelector('.g-replace').value.trim() }))
    .filter((g) => g.find);
  const keepTerms = $('#keepTerms').value.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const footers = Object.fromEntries(['tr', 'en', 'nl'].map((l) => [l, $(`#footer-${l}`).value]));
  const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ glossary, keepTerms, footers }) });
  toast(res.ok ? 'Ayarlar kaydedildi' : 'Kaydedilemedi');
});

// ---------- start ----------

showView(VIEWS[location.hash.slice(1)] || 'product');
refreshLibraryCount();
// a bulk run started earlier (maybe in another tab) keeps reporting here
fetch('/api/bulk')
  .then((r) => r.json())
  .then((job) => job?.running && pollBulk())
  .catch(() => {});
