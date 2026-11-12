import * as cheerio from 'cheerio';

export const LANGS = { tr: 'Türkçe', en: 'English', nl: 'Nederlands' };
const LANG_NAMES_EN = { tr: 'Turkish', en: 'English', nl: 'Dutch' };

// Claude when credentials exist (better with product jargon and HTML), otherwise
// Google's keyless endpoint so the app works out of the box.
export const provider = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'claude' : 'google';

// ---------- segment extraction ----------

// Turns the translatable fields into a flat list of strings and returns a
// function that rebuilds the fields from the translated list.
function toSegments(fields) {
  const segs = [];
  const add = (s) => {
    const v = String(s ?? '').trim();
    if (!v) return -1;
    segs.push(v);
    return segs.length - 1;
  };

  const nameIdx = add(fields.name);
  const shortIdx = add(fields.shortDescription);
  const catIdx = add(fields.category);
  const specIdx = fields.specs.map((g) => ({
    title: add(g.title),
    rows: g.rows.map((r) => ({ key: add(r.key), value: add(r.value) })),
  }));

  // description: translate whole blocks (paragraphs, list items, cells) so
  // sentences stay intact; inline tags inside a block are flattened.
  const $ = cheerio.load(`<div id="r">${fields.descriptionHtml || ''}</div>`);
  const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, dt, dd';
  const blocks = [];
  $('#r')
    .find(BLOCK)
    .each((_, el) => {
      if ($(el).find(BLOCK).length) return; // only innermost blocks
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) blocks.push({ el, idx: add(text), hasImg: $(el).find('img').length > 0 });
    });
  // loose text directly under the root or under wrapper divs
  const loose = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === 'text' && child.data.trim()) loose.push({ node: child, idx: add(child.data.replace(/\s+/g, ' ').trim()) });
      else if (child.type === 'tag' && !$(child).is(BLOCK) && !$(child).find(BLOCK).length && child.name !== 'div') continue;
      else if (child.type === 'tag' && !$(child).is(BLOCK)) walk(child);
    }
  };
  walk($('#r')[0]);

  const rebuild = (out, to) => {
    const get = (i, orig = '') => {
      if (i < 0) return orig;
      const t = out[i] ?? segs[i];
      // keep the source's leading capital ("Voltaj" -> "Voltage", not "voltage")
      return /^\p{Lu}/u.test(segs[i]) ? t.charAt(0).toLocaleUpperCase(to) + t.slice(1) : t;
    };
    for (const b of blocks) {
      const imgs = b.hasImg ? $(b.el).find('img').toArray().map((i) => $.html(i)).join('') : '';
      $(b.el).text(get(b.idx));
      if (imgs) $(b.el).append(imgs);
    }
    for (const t of loose) t.node.data = ' ' + get(t.idx) + ' ';
    return {
      name: get(nameIdx),
      shortDescription: get(shortIdx),
      category: get(catIdx),
      descriptionHtml: $('#r').html() || '',
      specs: specIdx.map((g) => ({
        title: get(g.title),
        rows: g.rows.map((r) => ({ key: get(r.key), value: get(r.value) })),
      })),
    };
  };
  return { segs, rebuild };
}

// ---------- providers ----------

async function googleTranslate(segs, from, to) {
  const out = new Array(segs.length);
  // pack segments into ~4000 char requests, one paragraph per segment
  // (a blank line keeps Google from merging neighbours into one sentence)
  let batch = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const lines = batch.map((b) => b.text);
    const translated = await googleRequest(lines.join('\n\n'), from, to);
    const parts = translated.split(/\n\s*\n/);
    if (parts.length === lines.length) {
      batch.forEach((b, i) => (out[b.i] = parts[i].trim()));
    } else {
      // line count drifted (rare) - fall back to one request per segment
      for (const b of batch) out[b.i] = (await googleRequest(b.text, from, to)).trim();
    }
    batch = [];
    size = 0;
  };
  for (let i = 0; i < segs.length; i++) {
    const text = segs[i].replace(/\n+/g, ' ');
    if (size + text.length > 4000) await flush();
    batch.push({ i, text });
    size += text.length + 2;
  }
  await flush();
  return out;
}

async function googleRequest(text, from, to) {
  const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + (from || 'auto') + '&tl=' + to, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: text }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Google Çeviri hatası (HTTP ${res.status}). Çok sık istek atıldıysa biraz bekleyin.`);
  const data = await res.json();
  return data[0].map((p) => p[0]).join('');
}

let claudeClient;
async function claudeTranslate(segs, from, to) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
  const { z } = await import('zod');
  claudeClient ??= new Anthropic();

  const response = await claudeClient.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: betaZodOutputFormat(z.object({ translations: z.array(z.string()) })),
    },
    system:
      'You translate e-commerce product content for an online store. Translate each string in the input array ' +
      'and return the translations in the same order, one output string per input string. Keep product codes, ' +
      'model numbers, brand names, units and numbers unchanged. Use natural, retail-style wording for the target market.',
    messages: [
      {
        role: 'user',
        content: `Source language: ${LANG_NAMES_EN[from] || 'detect automatically'}\nTarget language: ${LANG_NAMES_EN[to]}\n\n${JSON.stringify(segs)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('Claude bu içeriği çevirmeyi reddetti.');
  const out = response.parsed_output?.translations;
  if (!out || out.length !== segs.length) throw new Error('Claude çevirisi eksik döndü.');
  return out;
}

// ---------- public ----------

export async function translateFields(fields, from, to) {
  const { segs, rebuild } = toSegments(fields);
  if (!segs.length) return rebuild([], to);
  const out = provider === 'claude' ? await claudeTranslate(segs, from, to) : await googleTranslate(segs, from, to);
  return rebuild(out, to);
}
