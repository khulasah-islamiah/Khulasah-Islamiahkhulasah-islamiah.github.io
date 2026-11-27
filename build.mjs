// Khulasah Islamiah — static site builder (no dependencies).
// Usage:  node build.mjs          -> builds dist/ (website)
//         node build.mjs --pdf    -> also renders one two-language dist/pdf/<slug>.pdf per book with Playwright (if installed)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');
const LANGS = ['th', 'ms'];

// ---------- tiny Markdown → HTML (headings, paragraphs, lists, quotes, bold/italic, links) ----------
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

function markdown(src, idPrefix) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [], toc = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote>${markdown(quote.join('\n'), idPrefix + 'q').html}</blockquote>`); quote = []; };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (/^>\s?/.test(line)) { flushPara(); flushList(); quote.push(line.replace(/^>\s?/, '')); continue; }
    flushQuote();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushAll();
      const level = Math.max(2, m[1].length); // the page owns <h1>, so "#" and "##" both become <h2>
      const id = `${idPrefix}-${toc.length + 1}`;
      if (level === 2) toc.push({ id, text: m[2] });
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return { html: out.join('\n'), toc };
}

// ---------- read books ----------
function parseBook(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter (--- ... ---)`);
  const meta = {};
  for (const l of m[1].split('\n')) {
    const i = l.indexOf(':');
    if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  meta.slug = meta.slug || path.basename(file, '.md');
  meta.sample = meta.sample === 'true';
  const parts = {};
  let cur = null;
  for (const l of m[2].split('\n')) {
    const h = l.match(/^===\s*(th|ms)\s*===\s*$/);
    if (h) { cur = h[1]; parts[cur] = []; continue; }
    if (cur) parts[cur].push(l);
  }
  meta.summary = {};
  for (const lang of LANGS) {
    meta.summary[lang] = markdown((parts[lang] || []).join('\n'), `${meta.slug}-${lang}`);
  }
  for (const k of ['title_ar', 'title_th', 'title_ms', 'author_ar', 'author_th', 'author_ms', 'category']) {
    if (!meta[k]) console.warn(`  ! ${path.basename(file)}: missing "${k}"`);
  }
  return meta;
}

const categories = JSON.parse(fs.readFileSync(path.join(ROOT, 'categories.json'), 'utf8'));
const books = fs.readdirSync(path.join(ROOT, 'books'))
  .filter(f => f.endsWith('.md') && !f.startsWith('_'))
  .map(f => parseBook(path.join(ROOT, 'books', f)))
  .sort((a, b) => (a.sample - b.sample) || (b.added || '').localeCompare(a.added || '') || a.slug.localeCompare(b.slug));

// One PDF per book holding both languages. A ready-made pdf/<slug>.pdf wins; otherwise one is generated with --pdf.
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'pdf'), { recursive: true });
for (const dir of ['assets', 'covers']) if (fs.existsSync(path.join(ROOT, dir))) fs.cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true, filter: f => !f.endsWith('logo-original.png') });
for (const b of books) if (b.cover && !fs.existsSync(path.join(ROOT, b.cover))) { console.warn(`  ! ${b.slug}: cover not found: ${b.cover}`); delete b.cover; }
const wantPdf = process.argv.includes('--pdf');
for (const b of books) {
  const own = path.join(ROOT, 'pdf', `${b.slug}.pdf`);
  if (fs.existsSync(own)) fs.copyFileSync(own, path.join(DIST, 'pdf', `${b.slug}.pdf`));
}

// ---------- write site ----------
function writeSite() {
for (const b of books) if (fs.existsSync(path.join(DIST, 'pdf', `${b.slug}.pdf`))) b.pdf = `pdf/${b.slug}.pdf`;
const template = fs.readFileSync(path.join(ROOT, 'src', 'template.html'), 'utf8');
const data = JSON.stringify({ categories, books }).replace(/</g, '\\u003c');
const body = template.replace('/*__DATA__*/', () => data);
const page = `<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${body.split('</style>')[0]}</style>\n</head>\n<body>\n${body.split('</style>').slice(1).join('</style>')}\n</body>\n</html>\n`;
fs.writeFileSync(path.join(DIST, 'index.html'), page);
fs.writeFileSync(path.join(DIST, 'preview.html'), body); // body-only copy, used for the claude.ai preview
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`Built ${books.length} books → dist/index.html`);
}

// ---------- PDFs ----------
if (wantPdf) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    try { const { createRequire } = await import('node:module'); ({ chromium } = createRequire(import.meta.url)('playwright')); }
    catch { console.warn('Playwright not installed: skipping PDFs (npm i -D playwright)'); }
  }
  if (chromium) {
  const cat = id => categories.find(c => c.id === id) || {};
  const LOGO64 = fs.readFileSync(path.join(ROOT, 'assets', 'logo-mark.png')).toString('base64');
  const browser = await chromium.launch();
  const tab = await browser.newPage();
  const HEAD = { th: 'ภาษาไทย', ms: 'بهاس ملايو (جاوي)' };
  for (const b of books) {
    const out = path.join(DIST, 'pdf', `${b.slug}.pdf`);
    if (fs.existsSync(out)) continue;
    const part = lang => {
      const rtl = lang === 'ms';
      return `<section class="part ${lang}" lang="${rtl ? 'ms-Arab' : 'th'}" dir="${rtl ? 'rtl' : 'ltr'}">
<div class="parthead"><span class="ttl2">${esc(b['title_' + lang] || '')}</span><span class="lang">${HEAD[lang]}</span></div>
${b.summary[lang].html}</section>`;
    };
    const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&family=Noto+Sans+Thai:wght@400;700&display=swap">
<style>@page{size:A5;margin:18mm 16mm}body{font-family:"Noto Sans Thai",sans-serif;font-size:11pt;line-height:1.7;color:#111;margin:0}
.ar{font-family:"Amiri",serif}
.cover{text-align:center;height:170mm;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2mm;page-break-after:always}
.cover .ttl{font-size:28pt;font-weight:700;line-height:1.5}.cover .rule{width:50%;border-top:1px solid #999;margin:4mm 0}
.cover .th{font-size:15pt;font-weight:700}.cover .ms{font-family:"Noto Naskh Arabic","Amiri",serif;font-size:15pt;font-weight:700}
.cover p{margin:0;color:#444}.cover .brand{margin-top:10mm;font-size:9pt;color:#02381b}
.part{page-break-before:always}.part.ms{font-family:"Noto Naskh Arabic","Amiri",serif;font-size:12.5pt;line-height:2}
.parthead{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #02381b;padding-bottom:2mm;margin-bottom:4mm;color:#02381b}
.parthead .ttl2{font-weight:700;font-size:13pt}.parthead .lang{font-size:9pt}
blockquote{margin:4mm 0;padding:2mm 4mm;border-inline-start:2px solid #b5503b;background:#f6f1e6}h2{font-size:13pt;margin-top:7mm}</style></head><body>
<div class="cover"><img src="data:image/png;base64,${LOGO64}" style="height:24mm;margin-bottom:6mm" alt="">
<span class="ar ttl" dir="rtl">${esc(b.title_ar)}</span><p class="ar" dir="rtl">${esc(b.author_ar)}</p>
<span class="rule"></span>
<span class="th">${esc(b.title_th)}</span><p>${esc(b.author_th)}</p>
<span class="ms" dir="rtl">${esc(b.title_ms)}</span><p class="ms" dir="rtl" style="font-weight:400;font-size:11pt">${esc(b.author_ms)}</p>
<span class="brand">Khulasah Islamiah · <span class="ar">خلاصة إسلامية</span></span></div>
${part('th')}
${part('ms')}
</body></html>`;
    await tab.setContent(html, { waitUntil: 'networkidle' });
    await tab.evaluate(() => document.fonts.ready);
    await tab.pdf({ path: out, format: 'A5', printBackground: true, preferCSSPageSize: true });
    console.log(`  pdf → ${path.relative(ROOT, out)}`);
  }
  await browser.close();
  }
}
writeSite();
