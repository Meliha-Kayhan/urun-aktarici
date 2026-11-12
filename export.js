// Export saved products as files that store platforms import directly.
// A "record" is the edited product as the screen collects it:
//   { url, sku, barcode, brand, price, currency, images: [url], documents, variants,
//     languages: { tr: { name, category, shortDescription, descriptionHtml, specs }, en, nl } }

const LANG_LABEL = { tr: 'TR', en: 'EN', nl: 'NL' };

// "2.499,90" / "2,499.90" / "₺2499.9" -> "2499.90"; empty when it isn't a price
export function normalizePrice(raw) {
  let s = String(raw ?? '').replace(/[^\d.,]/g, '');
  if (!s) return '';
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(',', '.');
  } else if (lastComma > -1) {
    // "12,90" is a decimal comma, "1,299" a thousands separator
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, ''); // "1.500" (Turkish thousands)
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function specsTableHtml(specs) {
  if (!specs?.length) return '';
  const rows = specs.flatMap((g) => [
    ...(specs.length > 1 && g.title ? [`<tr><th colspan="2">${esc(g.title)}</th></tr>`] : []),
    ...g.rows.map((r) => `<tr><td>${esc(r.key)}</td><td>${esc(r.value)}</td></tr>`),
  ]);
  return `<table>\n${rows.join('\n')}\n</table>`;
}

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

function toCsv(rows, sep = ',') {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = String(v ?? '');
          return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(sep)
    )
    .join('\r\n');
}

// common option names in each language ("Size" -> "Beden" / "Maat")
const OPTION_LABELS = [
  [/^(size|beden|maat|größe|groesse|numara|taille)$/i, { tr: 'Beden', en: 'Size', nl: 'Maat' }],
  [/^(colou?r|renk|kleur|farbe|couleur)$/i, { tr: 'Renk', en: 'Color', nl: 'Kleur' }],
  [/^(material|malzeme|materiaal)$/i, { tr: 'Malzeme', en: 'Material', nl: 'Materiaal' }],
  [/^(capacity|kapasite|capaciteit|storage|depolama)$/i, { tr: 'Kapasite', en: 'Capacity', nl: 'Capaciteit' }],
  [/^(model)$/i, { tr: 'Model', en: 'Model', nl: 'Model' }],
];
const optionLabel = (name, lang) => OPTION_LABELS.find(([re]) => re.test(name.trim()))?.[1][lang] || name;

const langOf = (r, lang) => r.languages?.[lang] || r.languages?.tr || Object.values(r.languages || {})[0] || {};
const optionNames = (variants) => [...new Set((variants || []).flatMap((v) => Object.keys(v.options || {})))].slice(0, 3);

// ---------- WooCommerce (Products > Import, built-in CSV importer) ----------

export function woocommerceCsv(records, lang) {
  // every attribute column set the widest product needs
  const attrCount = Math.max(1, ...records.map((r) => optionNames(r.variants).length + (langOf(r, lang).specs || []).flatMap((g) => g.rows).length));
  const head = [
    'Type', 'SKU', 'Name', 'Published', 'Is featured?', 'Visibility in catalog', 'Short description', 'Description',
    'In stock?', 'Regular price', 'Categories', 'Tags', 'Images', 'Parent', 'GTIN, UPC, EAN, or ISBN',
  ];
  for (let i = 1; i <= attrCount; i++) head.push(`Attribute ${i} name`, `Attribute ${i} value(s)`, `Attribute ${i} visible`, `Attribute ${i} global`);

  // the importer splits values on commas; "\," keeps a comma inside one value
  const wcValue = (v) => String(v ?? '').replace(/,/g, '\\,');
  const rows = [head];
  for (const r of records) {
    const t = langOf(r, lang);
    const opts = optionNames(r.variants);
    const variable = opts.length > 0;
    // WooCommerce needs unique SKUs: the parent can't reuse a variant's SKU
    let parentSku = r.sku || slug(t.name);
    if (variable && r.variants.some((v) => v.sku === parentSku)) parentSku = `${parentSku}-ANA`;
    const attrs = [
      ...opts.map((name) => [optionLabel(name, lang), [...new Set(r.variants.map((v) => v.options?.[name]).filter(Boolean))].map(wcValue).join(', '), 1, 0]),
      ...(t.specs || []).flatMap((g) => g.rows).map((row) => [row.key, wcValue(row.value), 1, 0]),
    ];
    const base = new Array(head.length).fill('');
    const set = (row, col, v) => (row[head.indexOf(col)] = v);

    const p = [...base];
    set(p, 'Type', variable ? 'variable' : 'simple');
    set(p, 'SKU', parentSku);
    set(p, 'Name', t.name);
    set(p, 'Published', -1); // draft: review before publishing
    set(p, 'Is featured?', 0);
    set(p, 'Visibility in catalog', 'visible');
    set(p, 'Short description', t.shortDescription);
    set(p, 'Description', t.descriptionHtml);
    set(p, 'In stock?', 1);
    if (!variable) set(p, 'Regular price', normalizePrice(r.price));
    set(p, 'Categories', t.category);
    set(p, 'Tags', r.brand || '');
    set(p, 'Images', (r.images || []).join(', '));
    set(p, 'GTIN, UPC, EAN, or ISBN', variable ? '' : r.barcode || '');
    attrs.slice(0, attrCount).forEach((a, i) => {
      const at = head.indexOf(`Attribute ${i + 1} name`);
      p.splice(at, 4, ...a);
    });
    rows.push(p);

    if (variable) {
      for (const v of r.variants) {
        const row = [...base];
        set(row, 'Type', 'variation');
        set(row, 'SKU', v.sku || '');
        set(row, 'Name', `${t.name} - ${v.title || Object.values(v.options || {}).join(' / ')}`);
        set(row, 'Published', 1);
        set(row, 'In stock?', v.available === false ? 0 : 1);
        set(row, 'Regular price', normalizePrice(v.price || r.price));
        set(row, 'Parent', parentSku);
        set(row, 'GTIN, UPC, EAN, or ISBN', v.barcode || '');
        opts.forEach((name, i) => {
          const at = head.indexOf(`Attribute ${i + 1} name`);
          row.splice(at, 4, optionLabel(name, lang), wcValue(v.options?.[name] || ''), '', 0);
        });
        rows.push(row);
      }
    }
  }
  return toCsv(rows);
}

// ---------- Shopify (Products > Import) ----------

export function shopifyCsv(records, lang) {
  const head = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
    'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
    'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price', 'Variant Requires Shipping',
    'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card',
    'SEO Title', 'SEO Description', 'Status',
  ];
  const rows = [head];
  for (const r of records) {
    const t = langOf(r, lang);
    const handle = slug(`${t.name} ${r.sku || ''}`) || slug(r.sku) || 'urun';
    const opts = optionNames(r.variants);
    // Shopify has no attribute fields, so the spec table goes under the description
    const body = [t.descriptionHtml, specsTableHtml(t.specs)].filter(Boolean).join('\n');
    const variants = opts.length
      ? r.variants
      : [{ sku: r.sku, price: r.price, barcode: r.barcode, available: true, options: { Title: 'Default Title' } }];
    const names = opts.length ? opts : ['Title'];
    const images = r.images || [];
    const count = Math.max(variants.length, images.length, 1);

    for (let i = 0; i < count; i++) {
      const row = new Array(head.length).fill('');
      const set = (col, v) => (row[head.indexOf(col)] = v);
      set('Handle', handle);
      if (i === 0) {
        set('Title', t.name);
        set('Body (HTML)', body);
        set('Vendor', r.brand || '');
        set('Type', (t.category || '').split('>').pop().trim());
        set('Tags', (t.category || '').split('>').map((c) => c.trim()).filter(Boolean).join(', '));
        set('Published', 'FALSE');
        set('Gift Card', 'FALSE');
        set('SEO Title', t.name);
        set('SEO Description', (t.shortDescription || '').slice(0, 320));
        set('Status', 'draft'); // review before publishing
      }
      const v = variants[i];
      if (v) {
        names.forEach((name, k) => {
          if (i === 0) set(`Option${k + 1} Name`, name === 'Title' ? name : optionLabel(name, lang));
          set(`Option${k + 1} Value`, v.options?.[name] || '');
        });
        set('Variant SKU', v.sku || '');
        set('Variant Grams', '');
        set('Variant Inventory Policy', 'deny');
        set('Variant Fulfillment Service', 'manual');
        set('Variant Price', normalizePrice(v.price || r.price));
        set('Variant Requires Shipping', 'TRUE');
        set('Variant Taxable', 'TRUE');
        set('Variant Barcode', v.barcode || '');
      }
      if (images[i]) {
        set('Image Src', images[i]);
        set('Image Position', i + 1);
        set('Image Alt Text', t.name);
      }
      rows.push(row);
    }
  }
  return toCsv(rows);
}

// ---------- general spreadsheet (Excel): every language side by side ----------

export function genericCsv(records) {
  const langs = ['tr', 'en', 'nl'];
  const head = ['Stok Kodu', 'Barkod', 'Marka', 'Fiyat', 'Para Birimi'];
  for (const l of langs) {
    head.push(`Ürün Adı (${LANG_LABEL[l]})`, `Kategori (${LANG_LABEL[l]})`, `Kısa Açıklama (${LANG_LABEL[l]})`, `Açıklama HTML (${LANG_LABEL[l]})`, `Özellikler HTML (${LANG_LABEL[l]})`);
  }
  head.push('Varyantlar', 'Görseller', 'Belgeler', 'Kaynak');
  const rows = [head];
  for (const r of records) {
    const row = [r.sku, r.barcode, r.brand, r.price, r.currency];
    for (const l of langs) {
      const t = r.languages?.[l] || {};
      row.push(t.name, t.category, t.shortDescription, t.descriptionHtml, specsTableHtml(t.specs));
    }
    row.push(
      (r.variants || []).map((v) => [v.sku, Object.values(v.options || {}).join('/'), v.price].filter(Boolean).join(' ')).join(' | '),
      (r.images || []).join(','),
      (r.documents || []).map((d) => d.url).join(','),
      r.url
    );
    rows.push(row);
  }
  // BOM + semicolons so Excel opens it with Turkish characters intact
  return '﻿' + toCsv(rows, ';');
}

export function exportFile(format, records, lang) {
  const date = new Date().toISOString().slice(0, 10);
  const one = records.length === 1 ? slug(records[0].sku || records[0].languages?.tr?.name) || 'urun' : `${records.length}-urun`;
  switch (format) {
    case 'woocommerce':
      return { name: `woocommerce_${lang}_${one}_${date}.csv`, type: 'text/csv; charset=utf-8', body: woocommerceCsv(records, lang) };
    case 'shopify':
      return { name: `shopify_${lang}_${one}_${date}.csv`, type: 'text/csv; charset=utf-8', body: shopifyCsv(records, lang) };
    case 'json':
      return { name: `urunler_${one}_${date}.json`, type: 'application/json; charset=utf-8', body: JSON.stringify(records.length === 1 ? records[0] : records, null, 2) };
    default:
      return { name: `urunler_${one}_${date}.csv`, type: 'text/csv; charset=utf-8', body: genericCsv(records) };
  }
}
