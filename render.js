// Opens the page in a real (headless) Chrome so content that only appears after
// JavaScript runs, a tab is clicked or the page is scrolled is captured too.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const COOKIE_BUTTON = /^(kabul|tümünü kabul|hepsini kabul|tamam|anladım|accept|accept all|allow all|i agree|agree|got it|ok|alle akzeptieren|akzeptieren|accepteren|alles accepteren|akkoord)/i;
const MORE_BUTTON = /^(daha fazla|devamını oku|devamı|tümünü göster|hepsini göster|show more|read more|view more|see more|load more|more details|meer|lees meer|toon meer|mehr|mehr anzeigen)/i;

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = await import('playwright');
    browserPromise = chromium.launch({ headless: true }).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) (await browserPromise).close().catch(() => {});
}

const settle = (page, ms = 4000) => page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
const stripHash = (u) => u.replace(/#.*$/, '');

export async function renderPage(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'tr-TR',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  // images/fonts/videos aren't needed to read the page and slow it down a lot
  await page.route('**/*', (route) =>
    ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue()
  );

  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (res && res.status() >= 400) throw new Error(`Sayfa açılamadı (HTTP ${res.status()}).`);
    await settle(page);
    await clickByText(page, COOKIE_BUTTON, 1);
    await autoScroll(page);
    const tabs = await openTabs(page, url);
    await expandSections(page);
    await settle(page, 2000);
    const html = await page.content();
    return { html: await appendTabSnapshots(page, html, tabs), finalUrl: page.url(), tabsOpened: tabs.length };
  } finally {
    await context.close();
  }
}

// Clicks without leaving the page: real links are skipped, and if a click still
// navigates somewhere else we go back.
async function safeClick(page, locator) {
  const href = await locator.getAttribute('href', { timeout: 500 }).catch(() => null);
  if (href && !href.startsWith('#') && !href.startsWith('javascript')) return false;
  const before = stripHash(page.url());
  const ok = await locator.click({ timeout: 1500 }).then(() => true, () => false);
  if (ok && stripHash(page.url()) !== before) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await settle(page, 3000);
    return false;
  }
  return ok;
}

// ---------- screenshot of the original page ----------
// Taken only when asked for: unlike renderPage, images are loaded so the page
// looks like it does for a visitor.

const SHOT_WIDTH = 1280;
const SHOT_MAX_HEIGHT = 12000; // very long pages are cut here to keep memory in check
const shots = new Map(); // url -> jpeg, the last few only

export async function screenshotPage(url) {
  if (shots.has(url)) return shots.get(url);
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'tr-TR', viewport: { width: SHOT_WIDTH, height: 900 } });
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (res && res.status() >= 400) throw new Error(`Sayfa açılamadı (HTTP ${res.status()}).`);
    await settle(page);
    await clickByText(page, COOKIE_BUTTON, 1);
    await autoScroll(page); // lazy-loaded images appear only after scrolling past them
    await page.waitForTimeout(800);
    const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), SHOT_MAX_HEIGHT);
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true, clip: { x: 0, y: 0, width: SHOT_WIDTH, height } });
    shots.set(url, jpeg);
    if (shots.size > 5) shots.delete(shots.keys().next().value);
    return jpeg;
  } finally {
    await context.close();
  }
}

async function clickByText(page, re, limit) {
  let clicked = 0;
  for (const role of ['button', 'link']) {
    const items = page.getByRole(role, { name: re });
    const n = await items.count();
    for (let i = 0; i < n && clicked < limit; i++) {
      if (await safeClick(page, items.nth(i))) clicked++;
    }
  }
  return clicked;
}

// lazy-loaded sections often only render once scrolled into view
async function autoScroll(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 20; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise((r) => setTimeout(r, 150));
      if (window.scrollY + window.innerHeight >= document.body.scrollHeight) break;
    }
    window.scrollTo(0, 0);
  });
  await settle(page, 2500);
}

// Finds tab-like controls, clicks each one and keeps a copy of the panel it shows.
// Sites that swap one shared panel's content per tab would otherwise lose all
// but the last tab.
async function openTabs(page, url) {
  const tabs = await page.evaluate(() => {
    const SEL = [
      '[role="tab"]', '[data-toggle="tab"]', '[data-bs-toggle="tab"]', '[data-toggle="pill"]', '[data-bs-toggle="pill"]',
      '[aria-controls]', '[data-tab]', '[data-tab-target]', '[data-target^="#"]', '[data-bs-target^="#"]',
      '[class*="tab" i] > li > a', '[class*="tab" i] > li > button', '[class*="tab" i] > a', '[class*="tab" i] > button',
      'a[href^="#"][class*="tab" i]', 'button[class*="tab" i]',
    ].join(',');
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(SEL)) {
      if (out.length >= 30 || seen.has(el) || !visible(el)) continue;
      if (el.closest('header, footer, [role="navigation"][class*="menu" i], [class*="cookie" i], [class*="megamenu" i]')) continue;
      const label = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label || label.length > 60) continue;
      const href = el.getAttribute('href');
      // a link to another page is navigation, not a tab
      if (href && !href.startsWith('#') && !href.startsWith('javascript')) continue;
      if (el.getAttribute('aria-expanded') !== null && !el.matches('[role="tab"]') && el.closest('nav')) continue;
      seen.add(el);
      el.setAttribute('data-ua-tab-idx', String(out.length));
      out.push({ idx: out.length, label });
    }
    return out;
  });

  const snapshots = [];
  for (const t of tabs) {
    const el = page.locator(`[data-ua-tab-idx="${t.idx}"]`);
    if (!(await safeClick(page, el))) continue;
    await page.waitForTimeout(250);
    await settle(page, 2500);
    if (stripHash(page.url()) !== stripHash(url)) continue;
    const html = await page.evaluate((idx) => {
      const tab = document.querySelector(`[data-ua-tab-idx="${idx}"]`);
      if (!tab) return null;
      const byId = (id) => (id ? document.getElementById(id.replace(/^#/, '')) : null);
      let panel =
        byId(tab.getAttribute('aria-controls')) ||
        (tab.getAttribute('href')?.startsWith('#') && tab.getAttribute('href').length > 1 ? byId(tab.getAttribute('href')) : null);
      for (const attr of ['data-target', 'data-bs-target', 'data-tab-target']) {
        const v = tab.getAttribute(attr);
        if (!panel && v) {
          try {
            panel = document.querySelector(v);
          } catch {}
        }
      }
      const v = tab.getAttribute('data-tab');
      if (!panel && v) panel = document.querySelector(`[data-tab-content="${CSS.escape(v)}"], [data-tab-target-content="${CSS.escape(v)}"], #${CSS.escape(v)}`);
      if (!panel) {
        // fall back to whichever panel is visible now
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight);
        panel = [...document.querySelectorAll('[role="tabpanel"], .tab-pane.active, .tab-content > .active, [class*="tab-content" i], [class*="tabcontent" i], [class*="tab-panel" i], [class*="tabpanel" i]')].find(visible);
      }
      return panel ? panel.outerHTML : null;
    }, t.idx);
    if (html) snapshots.push({ label: t.label, html });
  }
  return snapshots;
}

async function expandSections(page) {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
  });
  // accordions
  const collapsed = page.locator('[aria-expanded="false"]:visible');
  const n = Math.min(await collapsed.count(), 30);
  for (let i = n - 1; i >= 0; i--) {
    const el = collapsed.nth(i);
    const skip = await el
      .evaluate((e) => !!e.closest('header, footer, nav, [class*="menu" i], [class*="cookie" i], [class*="search" i]'))
      .catch(() => true);
    if (!skip) await safeClick(page, el);
  }
  await clickByText(page, MORE_BUTTON, 6);
}

// Adds copies of tab panels whose content is no longer in the final page
async function appendTabSnapshots(page, html, snapshots) {
  if (!snapshots.length) return html;
  // compare without whitespace: tag boundaries add or drop spaces
  const bodyText = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ''));
  const extra = [];
  for (const s of snapshots) {
    const text = await page.evaluate((h) => {
      const d = document.createElement('div');
      d.innerHTML = h;
      return d.textContent.replace(/\s+/g, '');
    }, s.html);
    if (!text || bodyText.includes(text.slice(0, 300))) continue;
    const label = s.label.replace(/[<>&"]/g, '');
    extra.push(`<section data-ua-tab="${label}"><h2>${label}</h2>${s.html}</section>`);
  }
  if (!extra.length) return html;
  return html.replace(/<\/body>/i, `<div data-ua-tabs>${extra.join('')}</div></body>`);
}
