import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SKU_LABELS = /^(stok\s*kodu|ürün\s*kodu|urun\s*kodu|model\s*kodu|model\s*no|ürün\s*no|sku|mpn|referans\s*(kodu|no)?|parça\s*(kodu|no)|kod)$/i;
const BARCODE_LABELS = /^(barkod|barcode|ean|gtin|upc)(\s*(no|kodu))?$/i;
const BRAND_LABELS = /^(marka|brand|üretici)$/i;

const SPEC_CONTAINER = /spec|ozellik|özellik|feature|attribute|teknik|technical|properties|detay/i;
const DESC_CONTAINER = /(^|[-_ ])(description|aciklama|açıklama|product[-_]?detail|detay)([-_ ]|$)|tab-description|product-description/i;
const NOT_PRODUCT_AREA =
  'footer, header, nav, aside, dialog, [class*="cookie"], [id*="cookie"], [class*="privacy"], [id*="privacy"], [class*="modal"], [class*="footer"], [id*="footer"], [class*="cart"]';
const SHORT_DESC_CONTAINER = /short[-_]?desc|summary|excerpt|kisa[-_]?aciklama|product[-_]?intro/i;

// ---------- fetching ----------

export async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sayfa açılamadı (HTTP ${res.status}). Site bot isteklerini engelliyor olabilir.`);

  const buf = Buffer.from(await res.arrayBuffer());
  return { html: decode(buf, res.headers.get('content-type')), finalUrl: res.url };
}

// Turkish sites still ship windows-1254 / iso-8859-9 sometimes
function decode(buf, contentType) {
  let charset = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// ---------- helpers ----------

const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const first = (...vals) => vals.map(clean).find(Boolean) || '';
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const typeIs = (node, t) => asArray(node?.['@type']).some((x) => String(x).toLowerCase() === t);

function absUrl(src, base) {
  if (!src) return '';
  try {
    return new URL(src.trim(), base).href;
  } catch {
    return '';
  }
}

function htmlToText(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, h5, h6, tr, div').each((_, el) => {
    $(el).append('\n');
  });
  return $('#r')
    .text()
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Keeps structure (paragraphs, lists, tables, emphasis) and drops everything else
function sanitizeHtml(html, base) {
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  const root = $('#r');
  root.find('script, style, noscript, iframe, form, button, input, select, svg, link, meta').remove();
  const allowed = new Set(['p', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'blockquote', 'span', 'div']);
  root.find('*').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (!allowed.has(tag)) {
      $el.replaceWith($el.contents());
      return;
    }
    const keep = {};
    if (tag === 'a' && $el.attr('href')) keep.href = absUrl($el.attr('href'), base);
    if (tag === 'img') {
      keep.src = absUrl($el.attr('data-src') || $el.attr('src'), base);
      if ($el.attr('alt')) keep.alt = $el.attr('alt');
    }
    for (const name of Object.keys(el.attribs || {})) $el.removeAttr(name);
    for (const [k, v] of Object.entries(keep)) if (v) $el.attr(k, v);
  });
  // unwrap meaningless wrappers
  root.find('span, div').each((_, el) => {
    const $el = $(el);
    if (!$el.children().length && !clean($el.text())) $el.remove();
  });
  root.find('span').each((_, el) => $(el).replaceWith($(el).contents()));
  return (root.html() || '').replace(/\n\s*\n+/g, '\n').trim();
}

// ---------- structured data ----------

function findJsonLdProduct($) {
  const nodes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).contents().text().trim());
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        nodes.push(n);
        if (n['@graph']) walk(n['@graph']);
        if (n.mainEntity) walk(n.mainEntity);
        if (n.hasVariant) walk(n.hasVariant);
      };
      walk(data);
    } catch {
      /* broken JSON-LD is common, ignore it */
    }
  });
  return nodes.find((n) => typeIs(n, 'product')) || nodes.find((n) => typeIs(n, 'productgroup')) || null;
}

function microdata($) {
  const scope = $('[itemtype*="schema.org/Product"]').first();
  if (!scope.length) return {};
  const prop = (name) => {
    const el = scope.find(`[itemprop="${name}"]`).first();
    return clean(el.attr('content') || el.attr('value') || el.text());
  };
  return {
    name: prop('name'),
    sku: prop('sku') || prop('productID') || prop('mpn'),
    brand: prop('brand'),
    price: prop('price'),
    currency: prop('priceCurrency'),
    descriptionHtml: scope.find('[itemprop="description"]').first().html() || '',
  };
}

function meta($, ...names) {
  for (const n of names) {
    const v = $(`meta[property="${n}"]`).attr('content') || $(`meta[name="${n}"]`).attr('content');
    if (clean(v)) return clean(v);
  }
  return '';
}

// ---------- spec tables ----------

function extractSpecs($) {
  const groups = [];
  const seen = new Set();

  const addGroup = (title, rows) => {
    rows = rows.filter((r) => r.key && r.value && r.key.length < 80 && r.value.length < 500);
    if (!rows.length) return;
    const sig = rows.map((r) => r.key + '=' + r.value).join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    groups.push({ title: clean(title), rows });
  };

  const containerHint = (el) => {
    const attrs = $(el)
      .parents()
      .addBack()
      .toArray()
      .slice(-6)
      .map((p) => `${p.attribs?.id || ''} ${p.attribs?.class || ''}`)
      .join(' ');
    return SPEC_CONTAINER.test(attrs);
  };

  const titleFor = (el) => {
    const cap = $(el).find('caption').first().text();
    if (clean(cap)) return cap;
    const prev = $(el).prevAll('h1,h2,h3,h4,h5,strong').first().text();
    return prev;
  };

  // 1. tables: key/value rows
  const tables = $('table')
    .toArray()
    .filter((t) => !$(t).closest(NOT_PRODUCT_AREA).length);
  const scored = tables.map((t) => ({ t, hinted: containerHint(t) }));
  const anyHinted = scored.some((s) => s.hinted);
  for (const { t, hinted } of scored) {
    if (anyHinted && !hinted) continue;
    if ($(t).find('table').length) continue; // layout tables
    const rows = [];
    $(t)
      .find('tr')
      .each((_, tr) => {
        const cells = $(tr).children('th, td');
        if (cells.length === 2) rows.push({ key: clean($(cells[0]).text()).replace(/:$/, ''), value: clean($(cells[1]).text()) });
      });
    // unhinted tables are only trusted when they look like short key/value pairs
    if (!hinted && rows.some((r) => r.key.length > 40 || r.value.length > 150)) continue;
    if (rows.length >= 2 || (rows.length === 1 && hinted)) addGroup(titleFor(t), rows);
  }

  // 2. definition lists
  $('dl').each((_, dl) => {
    const rows = [];
    $(dl)
      .children('dt')
      .each((_, dt) => {
        rows.push({ key: clean($(dt).text()).replace(/:$/, ''), value: clean($(dt).nextUntil('dt', 'dd').text()) });
      });
    if (rows.length >= 2) addGroup(titleFor(dl), rows);
  });

  // 3. "Key: Value" list items inside spec-looking containers
  $('ul, ol').each((_, list) => {
    if (!containerHint(list)) return;
    const rows = [];
    $(list)
      .children('li')
      .each((_, li) => {
        const kids = $(li).children();
        let key = '';
        let value = '';
        if (kids.length === 2) {
          key = clean($(kids[0]).text());
          value = clean($(kids[1]).text());
        } else {
          const m = /^([^:]{1,60}):\s*(.+)$/.exec(clean($(li).text()));
          if (m) [, key, value] = m;
        }
        if (key && value) rows.push({ key: key.replace(/:$/, ''), value });
      });
    if (rows.length >= 2) addGroup(titleFor(list), rows);
  });

  return groups;
}

function findInSpecs(groups, re) {
  for (const g of groups) for (const r of g.rows) if (re.test(r.key)) return r.value;
  return '';
}

// "Stok Kodu: ABC-123" anywhere in the visible text
function skuFromText($) {
  const text = $('body').text().replace(/\s+/g, ' ');
  const m = /(stok\s*kodu|ürün\s*kodu|model\s*kodu|sku)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9._\-/]{2,40})/i.exec(text);
  return m ? m[2] : '';
}

function findContainer($, re) {
  const candidates = $('[id], [class]')
    .toArray()
    .filter((el) => re.test(`${el.attribs.id || ''} ${el.attribs.class || ''}`))
    .filter((el) => !/^(body|html|head|meta|script|style|a|button|li|nav|header|footer)$/i.test(el.tagName))
    .map((el) => ({ el, len: clean($(el).text()).length }))
    .filter((c) => c.len > 20);
  if (!candidates.length) return null;
  // the innermost container holding real text is usually the content itself
  candidates.sort((a, b) => a.len - b.len);
  const best = candidates.find((c) => c.len > 80) || candidates[candidates.length - 1];
  return best.el;
}

// ---------- images ----------

function extractImages($, ld, base, shopify) {
  const out = [];
  const push = (u) => {
    const abs = absUrl(typeof u === 'object' ? u?.url || u?.contentUrl || u?.src : u, base);
    if (abs && !out.includes(abs) && !/\.svg(\?|$)/i.test(abs)) out.push(abs);
  };
  asArray(shopify?.images).forEach(push);
  asArray(ld?.image).forEach(push);
  $('meta[property="og:image"]').each((_, m) => push($(m).attr('content')));
  $('[itemtype*="schema.org/Product"] [itemprop="image"]').each((_, el) => push($(el).attr('content') || $(el).attr('src')));
  if (out.length < 2) {
    $('[class*="gallery"] img, [class*="product-image"] img, [class*="slider"] img, [id*="gallery"] img')
      .slice(0, 20)
      .each((_, img) => push($(img).attr('data-zoom-image') || $(img).attr('data-large') || $(img).attr('data-src') || $(img).attr('src')));
  }
  return out.slice(0, 20);
}

// ---------- Shopify ----------

async function tryShopify($, url) {
  const isShopify = $('script').text().includes('Shopify.shop') || $('link[href*="cdn.shopify.com"]').length > 0;
  if (!isShopify || !/\/products\//.test(url)) return null;
  try {
    const u = new URL(url);
    u.search = '';
    const res = await fetch(u.href.replace(/\/$/, '') + '.json', {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.json()).product || null;
  } catch {
    return null;
  }
}

// ---------- main ----------

export async function extractProduct(url) {
  const { html, finalUrl } = await fetchPage(url);
  return parseProduct(html, finalUrl);
}

export async function parseProduct(html, url) {
  const $ = cheerio.load(html);
  const ld = findJsonLdProduct($);
  const md = microdata($);
  const shopify = await tryShopify($, url);

  const offers = asArray(ld?.offers).flatMap((o) => (o?.offers ? asArray(o.offers) : [o]));
  const offer = offers[0] || {};

  const specs = extractSpecs($);
  if (ld?.additionalProperty) {
    const rows = asArray(ld.additionalProperty).map((p) => ({ key: clean(p.name), value: clean(p.value) }));
    if (rows.length) specs.unshift({ title: 'Ürün Özellikleri', rows: rows.filter((r) => r.key && r.value) });
  }

  // description: JSON-LD is often plain text, so prefer the on-page HTML when it exists
  const descEl = findContainer($, DESC_CONTAINER);
  let descriptionHtml = '';
  if (shopify?.body_html) descriptionHtml = shopify.body_html;
  else if (descEl) {
    descriptionHtml = $(descEl).html();
    // some themes put only the "Description" heading in the box and the text right after it
    if (clean($(descEl).text()).length < 40) {
      descriptionHtml += $(descEl)
        .nextAll()
        .slice(0, 3)
        .toArray()
        .filter((el) => /^(p|div|ul|ol|section)$/i.test(el.tagName) && !$(el).find('table').length)
        .map((el) => $.html(el))
        .join('');
    }
  } else if (md.descriptionHtml) descriptionHtml = md.descriptionHtml;
  descriptionHtml = sanitizeHtml(descriptionHtml || '', url);
  const fallbackDesc = ld?.description || meta($, 'og:description', 'description');
  if (clean(htmlToText(descriptionHtml)).length < 40 && fallbackDesc) {
    descriptionHtml = String(fallbackDesc)
      .split(/\n\s*\n/)
      .map((p) => clean(p).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .filter(Boolean)
      .map((p) => `<p>${p}</p>`)
      .join('\n');
  }

  const shortEl = findContainer($, SHORT_DESC_CONTAINER);
  const shortDescription = first(
    shortEl && htmlToText($(shortEl).html() || '').slice(0, 600),
    meta($, 'og:description', 'description', 'twitter:description')
  );

  const brand =
    typeof ld?.brand === 'object' ? first(ld.brand?.name) : first(ld?.brand, md.brand, shopify?.vendor, findInSpecs(specs, BRAND_LABELS));

  const sku = first(
    ld?.sku,
    ld?.mpn,
    md.sku,
    shopify?.variants?.[0]?.sku,
    findInSpecs(specs, SKU_LABELS),
    ld?.productID,
    skuFromText($)
  );

  const barcode = first(ld?.gtin13, ld?.gtin, ld?.gtin12, ld?.gtin8, ld?.gtin14, shopify?.variants?.[0]?.barcode, findInSpecs(specs, BARCODE_LABELS));

  const name = first(ld?.name, md.name, shopify?.title, meta($, 'og:title'), $('h1').first().text(), $('title').text());

  return {
    url,
    name,
    sku,
    barcode,
    brand,
    price: first(offer.price, offer.lowPrice, md.price, shopify?.variants?.[0]?.price, meta($, 'product:price:amount', 'og:price:amount')),
    currency: first(offer.priceCurrency, md.currency, meta($, 'product:price:currency', 'og:price:currency')),
    availability: clean(offer.availability).replace(/^https?:\/\/schema\.org\//, ''),
    category: first(ld?.category, $('[class*="breadcrumb"] li, [class*="breadcrumb"] a').toArray().map((e) => clean($(e).text())).filter(Boolean).slice(1, -1).join(' > ')),
    shortDescription,
    descriptionHtml,
    descriptionText: htmlToText(descriptionHtml),
    specs,
    images: extractImages($, ld, url, shopify),
    sources: {
      jsonLd: !!ld,
      microdata: !!md.name,
      shopify: !!shopify,
    },
  };
}
