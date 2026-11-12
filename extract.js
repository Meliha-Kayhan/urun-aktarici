import * as cheerio from 'cheerio';
import { LANGS, provider, translateFields } from './translate.js';
import { renderPage } from './render.js';
import { formatDescription, localizeHeadings } from './format.js';
import { probeImages } from './images.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const SKU_LABELS =
  /^(stok\s*kodu|ürün\s*kodu|urun\s*kodu|model\s*kodu|model\s*no|ürün\s*no|sku|mpn|referans\s*(kodu|no)?|parça\s*(kodu|no)|kod|model|model\s*(number|name)|part\s*(number|no\.?)|item\s*(number|no\.?)|product\s*code|artikelnummer|artikelnr\.?)$/i;
const BARCODE_LABELS = /^(barkod|barcode|ean|gtin|upc)(\s*(no|kodu))?$/i;
const BRAND_LABELS = /^(marka|brand|üretici)$/i;

const SPEC_CONTAINER = /spec|ozellik|özellik|feature|attribute|teknik|technical|properties|detay/i;
const SPEC_HEADING = /specification|spec sheet|tech(nical)?\s*spec|spesifikasyon|özellik|ozellik|teknik|technical data|specificaties|kenmerken|technische|spezifikation|caractéristiques|properties/i;
// strong names are tried before weak ones, so "#overview" beats a generic "productDetail" wrapper
const DESC_CONTAINER_STRONG = /(^|[-_ ])(description|desc|aciklama|açıklama|overview|genel[-_]?bakis)([-_ ]|$)|tab-description|product-description/i;
const DESC_CONTAINER_WEAK = /(^|[-_ ])(product[-_]?detail|detay)([-_ ]|$)/i;
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
    // some sites double-escape entities in meta tags ("&amp;nbsp;" -> "&nbsp;")
    if (clean(v)) return clean(cheerio.load(`<p>${v}</p>`)('p').text().replace(/ /g, ' '));
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
    // a heading found further away is only trusted when it reads like a spec heading
    const h = nearestHeading($, el);
    return h && (h.direct || SPEC_HEADING.test(h.text)) ? h.text : '';
  };

  // a table counts as a spec table when its wrappers or the heading above it say so
  const isHinted = (el) => {
    if (containerHint(el)) return true;
    const h = nearestHeading($, el);
    if (h && SPEC_HEADING.test(h.text)) {
      $(h.el).attr('data-ua-spec', '');
      return true;
    }
    return false;
  };

  // 1. tables: key/value rows
  const tables = $('table')
    .toArray()
    .filter((t) => !inNonProductArea($, t) && !$(t).find('table').length);
  const scored = tables.map((t) => ({ t, hinted: isHinted(t) }));
  const anyHinted = scored.some((s) => s.hinted);
  for (const { t, hinted } of scored) {
    if (anyHinted && !hinted) continue;
    const trs = $(t).find('tr').toArray();
    const rows = [];
    for (const tr of trs) {
      const cells = $(tr).children('th, td');
      if (cells.length === 2) rows.push({ key: cellText($, cells[0]).replace(/:$/, ''), value: cellText($, cells[1]) });
    }
    if (!rows.length) continue;
    // "Part Number | Description" style tables are lists, not key/value specs
    const firstCells = $(trs[0]).children('th, td');
    const headerRow = firstCells.length > 0 && firstCells.toArray().every((c) => c.tagName === 'th') && trs.length > 1 && $(trs[1]).children('th').length === 0;
    if (!hinted && (headerRow || rows.length < trs.length * 0.8)) continue;
    // unhinted tables are only trusted when most keys look like short labels
    if (!hinted && rows.filter((r) => r.key.length <= 40).length < rows.length * 0.8) continue;
    if (rows.length >= 2 || hinted) {
      $(t).attr('data-ua-spec', '');
      addGroup(titleFor(t), rows);
    }
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

// Multi-line cells ("1x USB 2.0<br>3x USB 3.2") become "1x USB 2.0, 3x USB 3.2"
function cellText($, el) {
  const c = $(el).clone();
  c.find('br').replaceWith('\n');
  c.find('p, div, li').each((_, x) => {
    $(x).append('\n');
  });
  return c
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean)
    .join(', ');
}

// ---------- documents (datasheets, manuals, drawings) ----------

const DOC_EXT = /\.(pdf|zip|rar|7z|step|stp|dwg|dxf|igs|iges|stl|docx?|xlsx?|pptx?|exe|msi|dmg|tar\.gz|tgz)(\?|#|$)/i;

function extractDocuments($, base) {
  const docs = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const href = absUrl($(a).attr('href'), base);
    if (!href || seen.has(href)) return;
    if (!DOC_EXT.test(href) && $(a).attr('download') === undefined) return;
    if (inNonProductArea($, a)) return;
    seen.add(href);

    // the link is often just an icon; the label sits in the surrounding item
    let title = clean($(a).text());
    for (let p = a.parent, i = 0; !title && p && i < 4; p = p.parent, i++) {
      const t = clean($(p).clone().find('a, script, style, [class*="date"]').remove().end().text());
      if (t && t.length <= 80) title = t;
      else if (t) break;
    }
    const file = decodeURIComponent(href.split(/[?#]/)[0].split('/').pop() || '');
    const group = $(a).closest('[data-tab-target-content]').attr('data-tab-target-content') || '';
    docs.push({ title: title || file, group: clean(group).replace(/[-_]/g, ' '), file, url: href });
  });
  return docs.slice(0, 50);
}

// Footer, cookie banner, cart... A wrapper that also holds the product title
// (some themes name the page wrapper "stickyFooter") is not one of them.
function inNonProductArea($, el) {
  return $(el)
    .parents(NOT_PRODUCT_AREA)
    .toArray()
    .some((p) => !/^(body|html)$/i.test(p.tagName) && !$(p).find('h1').length);
}

// The closest heading above an element, looking through its own earlier
// siblings and then its ancestors' earlier siblings (page builders often put
// the heading in a separate block next to the table).
function nearestHeading($, el) {
  const H = 'h1, h2, h3, h4, h5, h6';
  let cur = el;
  for (let depth = 0; depth < 8 && cur && cur.tagName !== 'body'; depth++) {
    for (let sib = cur.prev; sib; sib = sib.prev) {
      if (sib.type !== 'tag') continue;
      const h = $(sib).is(H) ? $(sib) : $(sib).find(H).last();
      if (h.length && clean(h.text())) return { el: h[0], text: clean(h.text()), direct: depth === 0 && $(sib).is(H) };
    }
    cur = cur.parent;
  }
  return null;
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

// The largest file a srcset offers: "a.jpg 400w, b.jpg 1600w" -> b.jpg
function largestInSrcset(srcset) {
  if (!srcset) return '';
  const items = srcset
    .split(/,\s+(?=\S)/)
    .map((part) => {
      const [u, d] = part.trim().split(/\s+/);
      return { u, n: parseFloat(d) || 1 };
    })
    .filter((x) => x.u);
  items.sort((a, b) => b.n - a.n);
  return items[0]?.u || '';
}

// Thumbnail URLs rewritten to the full-size file where the pattern is well known
function fullSizeUrl(u) {
  // Shopify: name_300x300.jpg, name_small.png, ?width=300
  if (/cdn\.shopify\.com|\/cdn\/shop\//.test(u)) {
    u = u.replace(/_(?:\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande)(?:@\dx)?(?=\.(?:jpe?g|png|webp|gif)(?:\?|$))/i, '');
    u = u.replace(/([?&])(width|height|crop)=[^&]*&?/gi, '$1').replace(/[?&]$/, '');
  }
  // WordPress / WooCommerce: name-300x300.jpg
  u = u.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)(?:\?|$))/i, '');
  return u;
}

const IMG_JUNK = /^default\.|no-?image|logo|icon|sprite|placeholder|loading|spinner|blank|spacer|pixel|badge|flag|payment|avatar|rating|star/i;
const GALLERY =
  '[class*="gallery" i], [id*="gallery" i], [class*="product-image" i], [class*="product__media" i], [class*="product-media" i], [class*="slider" i], [class*="carousel" i], [class*="swiper" i], [class*="zoom" i], [class*="thumbnails" i], [class*="fotorama" i]';

// Candidate product images grouped by how much they can be trusted:
//   0 the shop's own product data (Shopify), 1 structured data, 2 the product
//   gallery, 3 the share image, 4 any other image in the product content.
// images.js measures them tier by tier and stops once a tier gives enough real
// photos, so banners and other colour variants don't sneak in.
function extractImages($, ld, base, shopify) {
  const out = [];
  const seen = new Set();
  const push = (u, tier) => {
    const raw = typeof u === 'object' ? u?.url || u?.contentUrl || u?.src : u;
    if (!raw || /^data:/i.test(raw)) return;
    const abs = absUrl(fullSizeUrl(raw.trim()), base);
    if (!abs || seen.has(abs) || /\.svg(\?|$)/i.test(abs) || IMG_JUNK.test(abs.split('?')[0].split('/').pop())) return;
    seen.add(abs);
    out.push({ url: abs, tier });
  };
  // every source a lazy-loading / zooming gallery might keep the big file in
  const bestOf = (img) => {
    const $i = $(img);
    const link = $i.closest('a').attr('href');
    return (
      $i.attr('data-zoom-image') || $i.attr('data-large_image') || $i.attr('data-large') || $i.attr('data-full') ||
      $i.attr('data-zoom') || $i.attr('data-original') ||
      (link && /\.(jpe?g|png|webp)(\?|$)/i.test(link) ? link : '') ||
      largestInSrcset($i.attr('srcset') || $i.attr('data-srcset')) ||
      $i.attr('data-src') || $i.attr('src')
    );
  };

  asArray(shopify?.images).forEach((u) => push(u, 0));
  asArray(ld?.image).forEach((u) => push(u, 1));
  $('[itemtype*="schema.org/Product"] [itemprop="image"]').each((_, el) => push($(el).attr('content') || $(el).attr('href') || bestOf(el), 1));
  $(GALLERY)
    .find('img')
    .each((_, img) => {
      if (!inUnrelatedArea($, img)) push(bestOf(img), 2);
    });
  $('[data-zoom-image], a[data-fancybox][href], a[data-lightbox][href]').each((_, el) => push($(el).attr('data-zoom-image') || $(el).attr('href'), 2));
  $('meta[property="og:image"]').each((_, m) => push($(m).attr('content'), 3));
  $('main img, [class*="product" i] img, [id*="product" i] img, article img').each((_, img) => {
    if (!inUnrelatedArea($, img)) push(bestOf(img), 4);
  });
  return out.slice(0, 60);
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

// ---------- whole-page sections ----------
// Instead of only looking where product content usually lives, every content
// block on the page is found, labelled by its heading or tab, and classified.
// Nothing is silently dropped: the UI lists every section so the user can
// move a misclassified one into specs or the description.

const UNRELATED = /related|recommend|similar|upsell|cross-?sell|recent|also-?(bought|viewed)|benzer|ilgili|onerilen|önerilen|review|yorum|comment|breadcrumb|newsletter|share|social|subscribe|cookie|consent|gdpr|onetrust|kvkk|header|navbar|menu|navigation/i;
const COOKIE_TEXT = /\b(cookies?|çerez(ler)?)\b/i;

function inUnrelatedArea($, el) {
  if (inNonProductArea($, el)) return true;
  return $(el)
    .parents()
    .addBack()
    .toArray()
    .some((p) => UNRELATED.test(`${p.attribs?.id || ''} ${p.attribs?.class || ''}`) && !$(p).find('h1').length);
}

// Heading inside the block's own panel wins; otherwise the name of the tab
// that opens the panel; otherwise the nearest heading above it.
function blockTitle($, el) {
  const snap = $(el).closest('[data-ua-tab]');
  if (snap.length) return snap.attr('data-ua-tab');
  const h = nearestHeading($, el);
  for (const p of $(el).parents('[id]').toArray()) {
    if (h && $(p).find(h.el).length) break;
    const id = p.attribs.id.replace(/["\\]/g, '');
    let label = '';
    try {
      label = clean($(`a[href="#${id}"], [aria-controls="${id}"], [data-target="#${id}"], [data-bs-target="#${id}"]`).first().text());
    } catch {
      /* odd ids */
    }
    const by = p.attribs['aria-labelledby'];
    if (!label && by) label = clean($(`[id="${by.replace(/["\\]/g, '')}"]`).text());
    if (label && label.length <= 60) return label;
  }
  return h?.text || '';
}

function listRows($, list) {
  return $(list)
    .children('li')
    .toArray()
    .map((li) => {
      const kids = $(li).children().toArray();
      if (kids.length === 2) return { key: clean($(kids[0]).text()).replace(/:$/, ''), value: cellText($, kids[1]) };
      const m = /^([^:]{1,50}):\s*(.+)$/.exec(clean($(li).text()));
      return m ? { key: m[1], value: m[2] } : null;
    })
    .filter((r) => r && r.key && r.value);
}

function scanSections($, base) {
  const blocks = [];
  const push = (el, kind, rows = []) => {
    if (!inUnrelatedArea($, el)) blocks.push({ el, kind, rows });
  };

  $('body table').each((_, t) => {
    if ($(t).find('table').length) return;
    const trs = $(t).find('tr').toArray();
    const rows = [];
    for (const tr of trs) {
      const c = $(tr).children('th, td');
      if (c.length === 2) rows.push({ key: cellText($, c[0]).replace(/:$/, ''), value: cellText($, c[1]) });
    }
    const kv = rows.filter((r) => r.key && r.value);
    if (kv.length >= 2 && kv.length >= trs.length * 0.6) push(t, 'kv', kv);
    else if (trs.length) push(t, 'table');
  });

  $('body dl').each((_, dl) => {
    const rows = $(dl)
      .children('dt')
      .toArray()
      .map((dt) => ({ key: clean($(dt).text()).replace(/:$/, ''), value: clean($(dt).nextUntil('dt', 'dd').text()) }))
      .filter((r) => r.key && r.value);
    if (rows.length >= 2) push(dl, 'kv', rows);
  });

  $('body ul, body ol').each((_, list) => {
    if ($(list).parents('ul, ol, table, dl').length) return;
    const lis = $(list).children('li').toArray();
    if (lis.length < 2) return;
    // menus and link lists are navigation, not content
    if (lis.every((li) => $(li).find('a').length && clean($(li).text()) === clean($(li).find('a').text()))) return;
    const rows = listRows($, list);
    if (rows.length >= 2 && rows.length >= lis.length * 0.6) push(list, 'kv', rows);
    else push(list, 'list');
  });

  // spec grids built from divs: <div><span>Ağırlık</span><span>1,8 kg</span></div> × n
  $('body div, body section').each((_, el) => {
    const kids = $(el).children().toArray();
    if (kids.length < 3) return;
    const rows = [];
    for (const k of kids) {
      const parts = $(k).children().toArray();
      if (parts.length !== 2 || $(k).find('table, ul, ol, dl, img, p').length) return;
      const key = clean($(parts[0]).text()).replace(/:$/, '');
      const value = cellText($, parts[1]);
      if (!key || !value || key.length > 50 || value.length > 300) return;
      rows.push({ key, value });
    }
    push(el, 'kv', rows);
  });

  $('body p').each((_, p) => {
    if (clean($(p).text()).length >= 30 && !$(p).closest('table, li, dl').length) push(p, 'text');
  });
  // text written straight into divs without <p>
  $('body div').each((_, d) => {
    if ($(d).children('div, p, ul, ol, table, section, article, dl, h1, h2, h3, h4, h5, h6').length) return;
    if (clean($(d).text()).length >= 80) push(d, 'text');
  });

  // document order, and drop blocks nested inside another block
  const order = new Map($('body *').toArray().map((el, i) => [el, i]));
  const inBlock = new Set(blocks.map((b) => b.el));
  const top = blocks
    .filter((b) => !$(b.el).parents().toArray().some((p) => inBlock.has(p)))
    .sort((a, b) => order.get(a.el) - order.get(b.el));

  const sections = [];
  for (const b of top) {
    const title = blockTitle($, b.el);
    let s = sections[sections.length - 1];
    // a new section starts at a new heading, or where key/value content meets prose
    if (!s || s.title !== title || s.kv !== (b.kind === 'kv')) sections.push((s = { title, kv: b.kind === 'kv', rows: [], parts: [] }));
    s.rows.push(...b.rows);
    s.parts.push($.html(b.el));
  }

  const seen = new Set();
  const out = [];
  for (const s of sections) {
    const html = sanitizeHtml(s.parts.join('\n'), base);
    const text = htmlToText(html);
    const sig = text.replace(/\s+/g, '').slice(0, 300);
    if (text.length < 15 || seen.has(sig)) continue;
    // cookie notices without a recognisable wrapper
    if (COOKIE_TEXT.test(text.slice(0, 200)) && text.length < 800) continue;
    seen.add(sig);
    // specs written as text lines: "Weight: 8.6oz", "Ağırlık: 1,8 kg"
    if (!s.rows.length) {
      const lines = text.split('\n');
      const kv = lines.map((l) => /^([^:]{1,40}):\s*(.{1,300})$/.exec(l)).filter(Boolean);
      if (kv.length >= 2 && kv.length >= lines.length * 0.6) s.rows = kv.map((m) => ({ key: clean(m[1]), value: clean(m[2]) }));
    }
    const rowChars = s.rows.reduce((n, r) => n + r.key.length + r.value.length, 0);
    const kind = s.rows.length >= 2 && rowChars >= text.replace(/\s+/g, '').length * 0.5 ? 'specs' : text.length >= 60 ? 'text' : 'other';
    out.push({ id: out.length, title: s.title, kind, rows: kind === 'specs' ? s.rows : [], html, text });
    if (out.length >= 40) break;
  }
  return out;
}

const rowSig = (r) => `${r.key}=${r.value}`.toLowerCase().replace(/\s+/g, '');

// ---------- languages ----------

function pageLanguage($) {
  const raw = $('html').attr('lang') || meta($, 'og:locale', 'language', 'content-language') || '';
  return raw.slice(0, 2).toLowerCase();
}

// prefer "nl" / "nl-NL" over regional variants like "nl-BE"
function alternates($, base) {
  const out = {};
  const rank = {};
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const tag = ($(el).attr('hreflang') || '').toLowerCase();
    const [code, region] = tag.split('-');
    const href = absUrl($(el).attr('href'), base);
    if (!code || code.length !== 2 || !href) return;
    const r = !region ? 0 : region === code ? 1 : 2;
    if (rank[code] === undefined || r < rank[code]) {
      out[code] = href;
      rank[code] = r;
    }
  });
  return out;
}

const pickTranslatable = (p) => ({
  name: p.name,
  shortDescription: p.shortDescription,
  category: p.category,
  descriptionHtml: p.descriptionHtml,
  specs: p.specs,
});

const sameUrl = (a, b) => a.replace(/[?#].*$/, '').replace(/\/$/, '') === b.replace(/[?#].*$/, '').replace(/\/$/, '');

// Each language comes from the best available source: the page itself, the
// site's own page in that language (hreflang), or machine translation.
async function addTranslations(p) {
  // measured in parallel with the translations below
  const images = probeImages(p.images, p.url);

  // keep the site's text for reference, then rebuild it into the standard layout
  p.originalDescriptionHtml = p.descriptionHtml;
  p.descriptionHtml = formatDescription(p);
  p.descriptionText = htmlToText(p.descriptionHtml);

  const translations = {};
  const src = LANGS[p.lang] ? p.lang : '';
  if (src) translations[src] = { ...pickTranslatable(p), source: 'original' };

  for (const lang of Object.keys(LANGS)) {
    const alt = p.alternates[lang];
    if (translations[lang] || !alt || sameUrl(alt, p.url)) continue;
    try {
      const { html, finalUrl } = await fetchPage(alt);
      const other = await parseProduct(html, finalUrl);
      other.descriptionHtml = formatDescription(other);
      if (other.name) translations[lang] = { ...pickTranslatable(other), source: 'site', sourceUrl: finalUrl };
    } catch {
      /* fall through to machine translation */
    }
  }

  for (const lang of Object.keys(LANGS)) {
    if (translations[lang]) continue;
    try {
      translations[lang] = { ...(await translateFields(pickTranslatable(p), src, lang)), source: provider };
    } catch (err) {
      translations[lang] = { ...pickTranslatable(p), source: 'error', error: err.message };
    }
  }

  for (const [lang, t] of Object.entries(translations)) {
    t.descriptionHtml = localizeHeadings(t.descriptionHtml, lang);
    t.descriptionText = htmlToText(t.descriptionHtml);
  }
  return { ...p, images: await images, translations, translator: provider };
}

// ---------- main ----------

// Default: open the page in a real browser and click through its tabs.
// fast: plain HTTP fetch (quicker, but misses content loaded by JavaScript).
export async function extractProduct(url, pastedHtml, { fast = false } = {}) {
  if (pastedHtml) return addTranslations({ ...(await parseProduct(pastedHtml, url)), mode: 'pasted' });

  if (!fast) {
    try {
      const { html, finalUrl, tabsOpened } = await renderPage(url);
      return addTranslations({ ...(await parseProduct(html, finalUrl)), mode: 'browser', tabsOpened });
    } catch (err) {
      const { html, finalUrl } = await fetchPage(url);
      return addTranslations({ ...(await parseProduct(html, finalUrl)), mode: 'fast', browserError: err.message });
    }
  }
  const { html, finalUrl } = await fetchPage(url);
  return addTranslations({ ...(await parseProduct(html, finalUrl)), mode: 'fast' });
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
  const descEl = findContainer($, DESC_CONTAINER_STRONG) || findContainer($, DESC_CONTAINER_WEAK);
  let descriptionHtml = '';
  if (shopify?.body_html) descriptionHtml = shopify.body_html;
  else if (descEl) {
    // the spec table already has its own section, don't repeat it in the description
    const body = $(descEl).clone();
    body.find('[data-ua-spec]').remove();
    descriptionHtml = body.html();
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

  // whole-page pass: pick up specs and text the targeted rules above missed
  const sections = scanSections($, url);
  const hadSpecs = specs.length > 0;
  const known = new Set(specs.flatMap((g) => g.rows.map(rowSig)));
  for (const s of sections) {
    if (s.kind !== 'specs') continue;
    if (hadSpecs && !SPEC_HEADING.test(s.title)) continue;
    const fresh = s.rows.filter((r) => !known.has(rowSig(r)));
    if (fresh.length < 2) continue;
    fresh.forEach((r) => known.add(rowSig(r)));
    specs.push({ title: s.title, rows: fresh });
  }
  if (clean(htmlToText(descriptionHtml)).length < 40) {
    const texts = sections.filter((s) => s.kind === 'text' && !SPEC_HEADING.test(s.title)).slice(0, 4);
    const joined = texts.map((s) => (s.title ? `<h3>${s.title.replace(/</g, '&lt;')}</h3>\n` : '') + s.html).join('\n');
    if (htmlToText(joined).length > htmlToText(descriptionHtml).length) descriptionHtml = joined;
  }
  const descFlat = htmlToText(descriptionHtml).replace(/\s+/g, '');
  for (const s of sections) {
    if (s.rows.length && s.rows.filter((r) => known.has(rowSig(r))).length >= s.rows.length * 0.6) s.usedAs = 'specs';
    else if (s.text.length && descFlat.includes(s.text.replace(/\s+/g, '').slice(0, 120))) s.usedAs = 'description';
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

  // page titles usually end with the site name: "D137 Carrier Board | AVerMedia"
  const stripSite = (t) => clean(t).replace(/\s+[|–—]\s+[^|–—]{2,40}$/, '');
  const name = first(ld?.name, md.name, shopify?.title, stripSite(meta($, 'og:title')), $('h1').first().text(), stripSite($('title').text()));

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
    documents: extractDocuments($, url),
    sections,
    lang: pageLanguage($),
    alternates: alternates($, url),
    sources: {
      jsonLd: !!ld,
      microdata: !!md.name,
      shopify: !!shopify,
    },
  };
}
