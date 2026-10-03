const express = require('express');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const LEADS_FILE = path.join(DATA_DIR, 'leads.jsonl');
const SITE_URL = (process.env.SITE_URL || 'https://growthifybrand.com').replace(/\/$/, '');
const SALES_EMAIL = process.env.SALES_EMAIL || 'growthifybrand@gmail.com';
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 12;
const rate = new Map();

fs.mkdirSync(REPORTS_DIR, { recursive: true });
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const hit = rate.get(key) || { start: now, count: 0 };
  if (now - hit.start > RATE_WINDOW_MS) { hit.start = now; hit.count = 0; }
  hit.count += 1; rate.set(key, hit);
  if (hit.count > RATE_MAX) return res.status(429).json({ error: 'Too many audit requests. Please try again later.' });
  next();
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return net.isIPv6(ip) && (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:'));
}

async function validateTarget(raw) {
  let u;
  try { u = new URL(String(raw || '').startsWith('http') ? String(raw) : `https://${String(raw || '')}`); }
  catch { throw new Error('Please enter a valid website URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    throw new Error('Only public HTTP/HTTPS websites can be analyzed.');
  }
  const ips = await dns.lookup(u.hostname, { all: true });
  if (!ips.length || ips.some(x => isPrivateIp(x.address))) throw new Error('That hostname cannot be analyzed.');
  u.hash = '';
  return u;
}

async function safeFetch(startUrl) {
  let current = await validateTarget(startUrl);
  for (let i = 0; i < 4; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(current.href, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'GrowthifyBrand-AuditBot/1.0 (+website audit)' }
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The website returned an invalid redirect.');
      current = await validateTarget(new URL(location, current.href).href);
      continue;
    }
    if (!response.ok) throw new Error(`Website returned HTTP ${response.status}.`);
    return { response, finalUrl: current.href };
  }
  throw new Error('Too many redirects.');
}

function cleanText(s = '') { return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function getTitle(h) { return (h.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim(); }
function getMeta(h, name) {
  const a = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  const b = new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["'][^>]*>`, 'i');
  return (h.match(a)?.[1] || h.match(b)?.[1] || '').trim();
}
function has(h, re) { return re.test(h); }

async function analyze(raw) {
  const { response, finalUrl } = await safeFetch(raw);
  const html = (await response.text()).slice(0, 2_000_000);
  const plain = cleanText(html);
  const title = getTitle(html);
  const description = getMeta(html, 'description');
  const images = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = images.filter(x => !/\balt\s*=\s*["'][^"']*["']/i.test(x)).length;
  const h1 = (html.match(/<h1\b[^>]*>/gi) || []).length;
  const links = html.match(/<a\b[^>]*href=["'][^"']+/gi) || [];
  const words = plain.split(/\s+/).filter(Boolean).length;
  const canonical = has(html, /<link\b[^>]*rel=["']canonical["']/i);
  const viewport = has(html, /<meta\b[^>]*name=["']viewport["']/i);
  const cta = /(get started|contact|book|buy|request|quote|demo|learn more|sign up|subscribe|free audit|let's talk|start now)/i.test(plain);
  const checks = [
    { label: 'Page title', ok: title.length >= 20 && title.length <= 65, detail: title ? `${title.length} characters — ${title}` : 'Missing' },
    { label: 'Meta description', ok: description.length >= 70 && description.length <= 165, detail: description ? `${description.length} characters` : 'Missing' },
    { label: 'H1 structure', ok: h1 === 1, detail: `${h1} H1 tag(s) found` },
    { label: 'Content depth', ok: words >= 450, detail: `~${words} readable words on the page` },
    { label: 'Image alt text', ok: images.length === 0 || missingAlt === 0, detail: images.length ? `${missingAlt} image(s) missing alt attributes` : 'No images detected' },
    { label: 'Canonical', ok: canonical, detail: canonical ? 'Canonical tag found' : 'Missing canonical' },
    { label: 'Mobile viewport', ok: viewport, detail: viewport ? 'Viewport configured' : 'Missing viewport meta' },
    { label: 'HTTPS', ok: finalUrl.startsWith('https://'), detail: finalUrl.startsWith('https://') ? 'Secure connection' : 'Not using HTTPS' },
    { label: 'Conversion CTA', ok: cta, detail: cta ? 'CTA language detected' : 'No obvious CTA detected' },
    { label: 'Internal links', ok: links.length >= 5, detail: `${links.length} anchor links detected` }
  ];
  const score = Math.round(checks.reduce((sum, c) => sum + (c.ok ? 10 : 2), 0));
  return { url: finalUrl, score, checks };
}

async function sendEmail({ email, reportUrl, score, url }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) return false;
  const subject = `Your Growth Score for ${new URL(url).hostname}: ${score}/100`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Your Growth Report is ready</h2><p>We analyzed <b>${new URL(url).hostname}</b> and found a Growth Score of <b>${score}/100</b>.</p><p><a href="${reportUrl}">Open your personalized Growth Report →</a></p></div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [email], subject, html })
  });
  if (!r.ok) throw new Error('The report was generated, but email delivery failed.');
  return true;
}

async function sendCrmLead(payload) {
  if (!process.env.CRM_WEBHOOK_URL) return;
  await fetch(process.env.CRM_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {});
}

app.post('/api/audit', rateLimit, async (req, res) => {
  try {
    const { url, email, consent } = req.body || {};
    if (!consent) throw new Error('Consent is required before we send the report.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');
    const result = await analyze(url);
    const reportId = crypto.randomBytes(12).toString('hex');
    const createdAt = new Date().toISOString();
    const report = { ...result, reportId, email, createdAt };
    fs.writeFileSync(path.join(REPORTS_DIR, `${reportId}.json`), JSON.stringify(report, null, 2));
    const lead = { reportId, email, url: result.url, score: result.score, createdAt, status: 'new', consent: true };
    fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
    const base = SITE_URL || `${req.protocol}://${req.get('host')}`;
    const reportUrl = `${base}/report.html?id=${encodeURIComponent(reportId)}`;
    await sendEmail({ email, reportUrl, score: result.score, url: result.url }).catch(() => {});
    await sendCrmLead({ ...lead, reportUrl });
    res.json({ ...result, reportId, reportUrl, emailSent: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM) });
  } catch (e) {
    res.status(e.name === 'AbortError' ? 504 : 400).json({ error: e.name === 'AbortError' ? 'The website took too long to respond.' : e.message || 'Audit failed.' });
  }
});

app.get('/api/report/:id', (req, res) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid report ID.' });
  const file = path.join(REPORTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Report not found.' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.get('/api/config', (req, res) => res.json({ salesEmail: SALES_EMAIL }));
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''}`));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL || `${req.protocol}://${req.get('host')}`}/</loc></url><url><loc>${SITE_URL || `${req.protocol}://${req.get('host')}`}/privacy.html</loc></url></urlset>`));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, HOST, () => console.log(`Growthify Brand listening on ${HOST}:${PORT}`));
