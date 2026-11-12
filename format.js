import * as cheerio from 'cheerio';

// Rebuilds the scraped description into the same layout for every product:
//   intro paragraph
//   "Key features": <strong>topic</strong> – one or two sentences
//   "What's in the box" (when the specs list the package contents)
// Tables, images, "[NEW]" badges, empty paragraphs and repeats are dropped.

export const HEADINGS = {
  features: { tr: 'Öne Çıkan Özellikler', en: 'Key Features', nl: 'Belangrijkste kenmerken' },
  box: { tr: 'Kutu İçeriği', en: "What's in the Box", nl: 'Inhoud van de verpakking' },
};

const SKIP_HEADING = /specification|spec sheet|teknik|technical|özellikler$|ordering|sipariş|download|indir|support|destek|faq|accessor|aksesuar|specificaties|related|benzer/i;
const BOX_LABEL = /^(package|package contents|packing list|in the box|what'?s in the box|kutu içeriği|paket içeriği|kutu icerigi|lieferumfang|inhoud( van de verpakking)?|verpakkingsinhoud)$/i;
// headings that just say "Description" carry no topic of their own
const GENERIC_HEADING = /^(ürün )?(açıklama(sı)?|aciklama|description|product description|overview|genel bakış|ürün detayları|product details|details|detaylar|beschrijving|productbeschrijving|omschrijving|beschreibung|about( this| the)? product)$/i;
const BADGE = /\[(new|yeni|nieuw|neu)\]|\b(new!|yeni!)\s*/gi;

const clean = (s) => String(s ?? '').replace(/ /g, ' ').replace(BADGE, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function firstSentences(text, max) {
  if (text.length <= max) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > max) break;
    out += s;
  }
  out = out.trim();
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return out;
}

// Flattens the description into headings, paragraphs and lists in reading order
function tokenize(html) {
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  const tokens = [];
  const BLOCK = 'p, ul, ol, table, h1, h2, h3, h4, h5, h6, div, section, article, blockquote, dl';
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === 'text') {
        const t = clean(child.data);
        if (t.length > 2) tokens.push({ type: 'para', text: t });
        continue;
      }
      if (child.type !== 'tag') continue;
      const tag = child.name.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const t = clean($(child).text());
        if (t) tokens.push({ type: 'heading', text: t });
      } else if (tag === 'p' || tag === 'blockquote') {
        const t = clean($(child).text());
        if (t.length > 2) tokens.push({ type: 'para', text: t });
      } else if (tag === 'ul' || tag === 'ol') {
        const items = $(child).children('li').toArray().map((li) => clean($(li).text())).filter((t) => t.length > 1);
        if (items.length) tokens.push({ type: 'list', items });
      } else if (tag === 'table' || tag === 'img' || tag === 'dl') {
        continue;
      } else if ($(child).find(BLOCK).length) {
        walk(child);
      } else {
        const t = clean($(child).text());
        if (t.length > 2) tokens.push({ type: 'para', text: t });
      }
    }
  };
  walk($('#r')[0]);

  // drop repeats (page builders often render mobile + desktop copies)
  const seen = new Set();
  return tokens.filter((t) => {
    const key = t.type === 'list' ? t.items.join('|') : t.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunk(tokens, name) {
  const chunks = [{ heading: '', paras: [], lists: [] }];
  const generic = (h) => GENERIC_HEADING.test(h) || (name && h.toLowerCase() === name.toLowerCase());
  for (const t of tokens) {
    if (t.type === 'heading') chunks.push({ heading: generic(t.text) ? '' : t.text, paras: [], lists: [] });
    else if (t.type === 'para') chunks[chunks.length - 1].paras.push(t.text);
    else chunks[chunks.length - 1].lists.push(t.items);
  }
  return chunks;
}

const listFromSection = (html) => {
  const $ = cheerio.load(html);
  const lists = $('ul, ol').toArray().map((l) => $(l).children('li').toArray().map((li) => clean($(li).text())));
  return lists.find((items) => items.length >= 3 && items.length <= 10 && items.every((i) => i.length >= 8 && i.length <= 200 && !/^[^:]{1,40}:/.test(i)));
};

export function formatDescription({ descriptionHtml, specs = [], sections = [], name = '' }) {
  const chunks = chunk(tokenize(descriptionHtml || ''), name);
  if (!chunks.some((c) => c.paras.length || c.lists.length)) return descriptionHtml || '';

  // intro: the first real paragraph (short taglines are skipped)
  let intro = [];
  const minIntro = chunks.some((c) => c.paras.some((p) => p.length >= 80)) ? 80 : 30;
  for (const c of chunks) {
    const i = c.paras.findIndex((p) => p.length >= minIntro);
    if (i === -1) continue;
    intro = [c.paras[i]];
    if (c.paras[i + 1] && c.paras[i + 1].length >= 80 && (c.paras[i] + c.paras[i + 1]).length <= 600) intro.push(c.paras[i + 1]);
    c.paras.splice(i, intro.length);
    break;
  }

  const features = [];
  for (const c of chunks) {
    if (features.length >= 8) break;
    if (!c.heading || SKIP_HEADING.test(c.heading)) continue;
    const body = c.paras.join(' ');
    if (body.length >= 20) features.push({ title: c.heading, text: firstSentences(body, 240) });
    else if (c.lists.length) {
      for (const item of c.lists.flat().slice(0, 8 - features.length)) features.push({ title: '', text: firstSentences(item, 200) });
    }
  }
  // no headed blocks: use a bullet list from the description, or a feature list elsewhere on the page
  if (!features.length) {
    const items =
      chunks.flatMap((c) => c.lists).find((l) => l.length >= 2) ||
      sections.filter((s) => s.kind === 'text' && !s.usedAs).map((s) => listFromSection(s.html)).find(Boolean) ||
      [];
    for (const item of items.slice(0, 8)) features.push({ title: '', text: firstSentences(item, 200) });
  }

  const boxRow = specs.flatMap((g) => g.rows).find((r) => BOX_LABEL.test(r.key.trim()));
  const box = boxRow ? boxRow.value.split(/,\s*(?=\d+\s*[x×]\s*)|;\s*|\n/).map(clean).filter(Boolean) : [];

  // nothing to restructure: keep the cleaned paragraphs
  if (!intro.length && !features.length) {
    const paras = chunks.flatMap((c) => c.paras).filter((p) => p.length >= 20).slice(0, 6);
    return paras.map((p) => `<p>${esc(p)}</p>`).join('\n') || descriptionHtml;
  }

  const out = intro.map((p) => `<p>${esc(p)}</p>`);
  if (features.length) {
    out.push(`<h3 data-k="features">${HEADINGS.features.en}</h3>`);
    out.push('<ul>');
    for (const f of features) out.push(f.title ? `<li><strong>${esc(f.title)}</strong> – ${esc(f.text)}</li>` : `<li>${esc(f.text)}</li>`);
    out.push('</ul>');
  }
  if (box.length) {
    out.push(`<h3 data-k="box">${HEADINGS.box.en}</h3>`);
    out.push(`<ul>${box.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  }
  return out.join('\n');
}

// ---------- short description ----------
// One or two plain sentences that say what the product is. Meta descriptions
// are often spec lists glued together ("Wafer1 x Micro HDMI…"), so every
// candidate is checked for real sentences before it is used.

const SHORT_MAX = 280;

const sentencesOf = (text) =>
  (clean(text).match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((s) => s.trim()).filter(Boolean);

// prose, not a list: real sentences, mostly words rather than numbers/codes.
// lenient: the shop's own short-description field may be terse ("18V, 2 akü, çantalı set.")
function readable(text, lenient = false) {
  const t = clean(text);
  if (t.length < 25 || /\.{3}$|…$/.test(t) && !/[.!?]\s/.test(t)) return false;
  const glued = (t.match(/[a-zçğıöşü)][A-ZÇĞİÖŞÜ0-9(]/g) || []).length; // "Wafer1", "Nano2x", ")2 x"
  const words = t.split(/\s+/);
  const codeLike = words.filter((w) => /\d/.test(w) || /^[\/|+×x-]$/.test(w)).length;
  if (lenient) return glued <= 1 && codeLike / words.length < 0.5;
  const sentence = sentencesOf(t).some((s) => /[.!?]$/.test(s) && s.split(/\s+/).length >= 5);
  return sentence && glued <= 1 && codeLike / words.length < 0.35;
}

// how strongly a sentence is about this product (mentions its code or name)
function aboutProduct(sentence, keys) {
  const s = sentence.toLowerCase();
  return keys.filter((k) => s.includes(k)).length;
}

function pickSentences(text, keys) {
  const sents = sentencesOf(text).filter((s) => s.split(/\s+/).length >= (keys.length ? 4 : 1));
  if (!sents.length) return '';
  // start at the first sentence that names the product; slogans before it are skipped
  let start = sents.findIndex((s) => aboutProduct(s, keys) > 0);
  if (start === -1) start = sents.findIndex((s) => s.length >= 60);
  if (start === -1) start = 0;
  let out = sents[start];
  if (out.length > SHORT_MAX) {
    // one long sentence: end it at the last comma that fits
    const cut = out.slice(0, SHORT_MAX).lastIndexOf(',');
    out = (cut > 80 ? out.slice(0, cut) : out.slice(0, SHORT_MAX).replace(/\s+\S*$/, '')).replace(/[,;:\s]+$/, '') + '.';
  } else if (sents[start + 1] && (out + ' ' + sents[start + 1]).length <= SHORT_MAX) {
    out += ' ' + sents[start + 1];
  }
  return out;
}

export function shortDescription({ siteShortDescription: siteShort, metaDescription, descriptionHtml, name = '', sku = '' }) {
  const keys = [sku, ...name.split(/\s+/).filter((w) => w.length >= 4 && /\d|[A-Z]{2,}/.test(w))]
    .map((k) => k.toLowerCase())
    .filter(Boolean);
  const intro = tokenize(descriptionHtml || '')
    .filter((t) => t.type === 'para')
    .map((t) => t.text)
    .join(' ');
  if (siteShort && readable(siteShort, true)) return pickSentences(siteShort, []) || clean(siteShort).slice(0, SHORT_MAX);
  for (const candidate of [metaDescription, intro]) {
    if (candidate && readable(candidate)) {
      const picked = pickSentences(candidate, keys);
      if (picked) return picked;
    }
  }
  // nothing reads like prose: fall back to the site's text, at least tidied up
  return clean(siteShort || metaDescription || name).replace(/([a-zçğıöşü)])([A-ZÇĞİÖŞÜ0-9(])/g, '$1 $2').slice(0, SHORT_MAX);
}

// Template headings are set per language instead of being machine-translated
export function localizeHeadings(html, lang) {
  if (!html.includes('data-k=')) return html;
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  $('#r [data-k]').each((_, el) => {
    const label = HEADINGS[el.attribs['data-k']]?.[lang];
    if (label) $(el).text(label);
    $(el).removeAttr('data-k');
  });
  return $('#r').html();
}
