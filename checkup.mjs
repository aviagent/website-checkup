#!/usr/bin/env node
// website-checkup: a plain-English report card for one web page. Node 18+, no dependencies.
// Usage: node checkup.mjs https://example.com   (add --json for machine-readable output)
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const UA = 'AviAgenticsCheckup/1.0 (+https://aviagentics.com/checkup/)';
const MAX_BYTES = 1.5 * 1024 * 1024, TIMEOUT_MS = 8000, MAX_REDIRECTS = 3;

function privateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fe80') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('::ffff:');
}

async function refuseReason(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https addresses can be checked.';
  if (u.username || u.password) return 'Addresses with a login in them cannot be checked.';
  if (u.port && u.port !== '80' && u.port !== '443') return 'Only standard web ports can be checked.';
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h.includes(':') || h.startsWith('[') || isIP(h)) return 'Please use a website name such as www.example.com, not a number address.';
  if (/(^|\.)(localhost|local|localdomain|internal|lan|home|corp|intranet|arpa)$/.test(h)) return 'That address is private and cannot be checked.';
  try {
    const addrs = await lookup(h, { all: true });
    if (addrs.some((a) => privateIp(a.address))) return 'That address points to a private network and cannot be checked.';
  } catch (e) { return 'We could not find that website.'; }
  return '';
}

async function readLimited(res) {
  const reader = res.body.getReader();
  const chunks = []; let total = 0, truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (total + value.length > MAX_BYTES) { chunks.push(value.slice(0, MAX_BYTES - total)); total = MAX_BYTES; truncated = true; try { await reader.cancel(); } catch (e) {} break; }
    chunks.push(value); total += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), bytes: total, truncated };
}

async function fetchPage(startUrl) {
  let url = startUrl;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const why = await refuseReason(url);
      if (why) return { error: why };
      const res = await fetch(url.href, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (hop === MAX_REDIRECTS) return { error: 'That site redirects too many times.' };
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      if (res.status >= 400) return { error: `That site answered with an error (${res.status}).` };
      const ct = res.headers.get('content-type') || '';
      if (ct && !/html|xml|text\/plain/i.test(ct)) return { error: 'That address is not a web page.' };
      return { ...(await readLimited(res)), finalUrl: url.href };
    }
  } catch (e) {
    return { error: ctl.signal.aborted ? 'That site took too long to answer (over 8 seconds).' : 'We could not reach that site.' };
  } finally { clearTimeout(timer); }
}

const CHAT_WORDS = ['intercom', 'tidio', 'drift', 'crisp', 'tawk', 'livechat', 'zendesk', 'hubspot', 'manychat', 'botpress', 'voiceflow'];
const ACTION_RE = /\b(book|booking|order|reserve|reservation|appointment|contact|quote|schedule|get in touch)\b/i;
const tag = (html, name) => html.match(new RegExp('<' + name + '\\b[^>]*>', 'gi')) || [];
const attr = (t, a) => { const m = t.match(new RegExp('\\b' + a + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null; };
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const metaContent = (html, key) => {
  for (const t of tag(html, 'meta')) {
    const k = attr(t, 'name') || attr(t, 'property');
    if (k && k.toLowerCase() === key) return decode((attr(t, 'content') || '').trim());
  }
  return '';
};

export function analyze(html, finalUrl, bytes, truncated, nowYear) {
  const checks = [];
  const add = (id, label, status, reason, fix) => checks.push({ id, label, status, reason, fix: status === 'pass' ? '' : fix });
  const visible = decode(html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  const https = /^https:/i.test(finalUrl);
  add('https', 'Secure connection (https)', https ? 'pass' : 'fail',
    https ? 'Your site loads over a secure connection, so browsers show the padlock.' : 'Your site is not served over https, so browsers warn visitors that it is "Not secure".',
    'Turn on a free security certificate with your hosting company and send all visitors to the https address.');

  const tm = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = tm ? decode(tm[1]).replace(/\s+/g, ' ').trim() : '';
  if (!title) add('title', 'Page title', 'fail', 'Your page has no title, so Google and browser tabs have nothing to show for it.', 'Add a title of 10 to 65 characters with your business name and what you do.');
  else if (title.length < 10 || title.length > 65) add('title', 'Page title', 'warn', `Your title is ${title.length} characters; ${title.length < 10 ? 'too short to tell people what you do' : 'Google will cut it off'}.`, 'Rewrite it to 10 to 65 characters: your business name and what you do.');
  else add('title', 'Page title', 'pass', `Your title is ${title.length} characters, a good length for Google and browser tabs.`, '');

  const desc = metaContent(html, 'description');
  if (!desc) add('description', 'Search description', 'fail', 'There is no description, so Google picks random text from your page to show under your name.', 'Add a one or two sentence description (about 50 to 160 characters) that makes someone want to click.');
  else if (desc.length < 50 || desc.length > 170) add('description', 'Search description', 'warn', `Your description is ${desc.length} characters; ${desc.length < 50 ? 'a little short' : 'Google will cut it off'}.`, 'Aim for about 50 to 160 characters.');
  else add('description', 'Search description', 'pass', 'You have a description for search results, and it is a good length.', '');

  const vp = tag(html, 'meta').some((t) => (attr(t, 'name') || '').toLowerCase() === 'viewport');
  add('viewport', 'Works on phones', vp ? 'pass' : 'fail',
    vp ? 'Your page tells phones how to fit it to the screen.' : 'Your page does not tell phones how to fit it, so it can look tiny and be hard to use on a phone.',
    'Add the mobile viewport tag and make sure the layout adapts to small screens.');

  const h1s = (html.match(/<h1\b/gi) || []).length;
  add('h1', 'One main heading', h1s === 1 ? 'pass' : h1s === 0 ? 'fail' : 'warn',
    h1s === 1 ? 'The page has one clear main heading.' : h1s === 0 ? 'The page has no main heading, so visitors and Google cannot tell at a glance what it is about.' : `The page has ${h1s} main headings, which muddles what it is about.`,
    'Use exactly one main heading that says what you do and where.');

  const hasTel = /href\s*=\s*["']?\s*tel:/i.test(html), hasMail = /href\s*=\s*["']?\s*mailto:/i.test(html);
  const phone = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(visible), email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(visible);
  const contact = hasTel || hasMail || phone || email;
  add('contact', 'Phone or email visible', contact ? 'pass' : 'fail',
    contact ? 'A phone number or email address is easy to find.' : 'No phone number or email is visible, so a ready-to-buy visitor has no way to reach you.',
    'Put your phone number or email at the top and bottom of the page.');

  let action = false;
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const text = decode(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    const href = attr('<a ' + m[2] + '>', 'href') || '';
    if (ACTION_RE.test(text) || (m[1].toLowerCase() === 'a' && /(book|order|reserve|appointment|contact|quote)/i.test(href))) { action = true; break; }
  }
  add('action', 'A clear next step', action ? 'pass' : 'warn',
    action ? 'There is a button or link to book, order or get in touch.' : 'No booking, order or contact button stands out, so visitors may leave without doing anything.',
    'Add one obvious button such as "Book now", "Order online" or "Get a quote".');

  const lower = html.toLowerCase();
  const chatFound = CHAT_WORDS.find((w) => lower.includes(w));
  add('chat', 'Chat or assistant', chatFound ? 'pass' : 'warn',
    chatFound ? 'There is a chat or assistant on the page, so questions can be answered any time.' : 'No chat or assistant found: visitors with questions at 11 p.m. have nobody to ask.',
    'Add a chat assistant that answers common questions and collects requests after hours.');

  const kb = Math.round(bytes / 1024);
  add('weight', 'Page size', bytes <= 300 * 1024 ? 'pass' : bytes <= 1024 * 1024 ? 'warn' : 'fail',
    `The page itself is ${kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'}${truncated ? ' or more' : ''}${bytes <= 300 * 1024 ? ', which is light and quick to load.' : ', which is heavy and slows loading on phones.'}`,
    'Trim extra code and plugins so the page loads fast on a phone.');

  const imgs = tag(html, 'img'), noAlt = imgs.filter((t) => attr(t, 'alt') === null).length;
  add('alt', 'Image descriptions', noAlt === 0 ? 'pass' : noAlt <= 3 ? 'warn' : 'fail',
    noAlt === 0 ? (imgs.length ? `All ${imgs.length} images have descriptions for screen readers and Google.` : 'No images on the page to describe.') : `${noAlt} of ${imgs.length} images have no description, which hurts accessibility and image search.`,
    'Give each meaningful image a short description of what it shows.');

  const years = [];
  for (const m of visible.matchAll(/(?:©|\(c\)|copyright)[^0-9]{0,30}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi)) years.push(+(m[2] || m[1]));
  const yr = years.length ? Math.max(...years) : null;
  if (yr && yr < nowYear) add('year', 'Footer year', 'warn', `The footer says ${yr}, which makes the site look unattended.`, 'Update the footer year, or make it fill in by itself.');
  else add('year', 'Footer year', 'pass', yr ? 'The footer year is current.' : 'No outdated copyright year found.', '');

  const ogt = metaContent(html, 'og:title'), ogi = metaContent(html, 'og:image');
  add('social', 'Link preview', ogt && ogi ? 'pass' : 'warn',
    ogt && ogi ? 'When your link is shared, it shows a title and picture.' : 'When your link is shared on Facebook, texts or WhatsApp, it shows a plain link' + (ogt || ogi ? ' with part of the preview missing.' : ' with no picture.'),
    'Add a share title and a share picture (og:title and og:image).');

  const pts = { pass: 1, warn: 0.5, fail: 0 };
  const score = Math.round((checks.reduce((s, c) => s + pts[c.status], 0) / checks.length) * 100);
  return { score, checks, facts: { title, bytes, images: imgs.length, imagesMissingAlt: noAlt } };
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
let raw = args.find((a) => !a.startsWith('--'));
if (!raw) { console.error('Usage: node checkup.mjs https://example.com [--json]'); process.exit(2); }
if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
let start;
try { start = new URL(raw); } catch (e) { console.error('That does not look like a website address.'); process.exit(2); }
const page = await fetchPage(start);
if (page.error) { console.error(page.error); process.exit(1); }
const r = analyze(page.text, page.finalUrl, page.bytes, page.truncated, new Date().getUTCFullYear());
if (asJson) { console.log(JSON.stringify({ url: start.href, finalUrl: page.finalUrl, score: r.score, checks: r.checks, facts: r.facts }, null, 2)); process.exit(0); }
const mark = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
console.log(`\nWebsite checkup: ${page.finalUrl}\nScore: ${r.score} / 100\n`);
for (const c of r.checks) {
  console.log(`[${mark[c.status]}] ${c.label}\n       ${c.reason}`);
  if (c.fix) console.log(`       Fix: ${c.fix}`);
}
console.log('');
