// User settings applied to every product after extraction and translation:
// the term glossary (fixes words machine translation gets wrong) and the fixed
// texts appended to every description.

import * as cheerio from 'cheerio';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// whole words only, so "Wafer" doesn't touch "Wafers"; case-insensitive, and a
// capitalised match keeps its capital ("gofret" -> "wafer", "Gofret" -> "Wafer")
function replacer(entries) {
  const rules = entries.map((g) => ({
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(g.find)}(?![\\p{L}\\p{N}])`, 'giu'),
    to: g.replace,
  }));
  return (text) => {
    if (!text) return text;
    for (const { re, to } of rules) {
      text = text.replace(re, (m) => (/^\p{Lu}/u.test(m) && to ? to.charAt(0).toLocaleUpperCase() + to.slice(1) : to));
    }
    return text;
  };
}

function replaceInHtml(html, fix) {
  if (!html) return html;
  const $ = cheerio.load(`<div id="r">${html}</div>`);
  const walk = (node) => {
    for (const c of node.children || []) {
      if (c.type === 'text') c.data = fix(c.data);
      else walk(c);
    }
  };
  walk($('#r')[0]);
  return $('#r').html();
}

export function applyGlossary(t, lang, glossary = []) {
  const entries = glossary.filter((g) => g.find && (g.lang === '*' || g.lang === lang));
  if (!entries.length) return t;
  const fix = replacer(entries);
  t.name = fix(t.name);
  t.category = fix(t.category);
  t.shortDescription = fix(t.shortDescription);
  t.descriptionHtml = replaceInHtml(t.descriptionHtml, fix);
  t.specs = (t.specs || []).map((g) => ({ title: fix(g.title), rows: g.rows.map((r) => ({ key: fix(r.key), value: fix(r.value) })) }));
  return t;
}

// fixed text (warranty, shipping...) as paragraphs at the end of the description
export function appendFooter(html, footer) {
  const text = String(footer || '').trim();
  if (!text) return html;
  const paras = text
    .split(/\n\s*\n|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('\n');
  return `${html || ''}\n<div data-footer="1">\n${paras}\n</div>`;
}
