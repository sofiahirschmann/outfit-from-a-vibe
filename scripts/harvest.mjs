#!/usr/bin/env node
// Harvest a seeded catalog from Nuuly's published products sitemap.
//
//   node scripts/harvest.mjs [--limit N] [--skip-tag] [--tag-only] [--refresh]
//
// Nuuly has no public API; robots.txt disallows /api and /rent/search but
// publishes /rent/products_sitemap.xml for crawlers (crawl-delay 1s). Each
// product page embeds a double-JSON-encoded initialState blob with structured
// product data (title, retail msrp, category facets, color hex, Scene7 image
// URLs) — far more reliable than the og:/JSON-LD tags, whose category is
// broken and whose price can coincidentally equal the $98 subscription.
//
// Output: data/catalog-raw.jsonl (resumable, one item per line) and
// data/catalog.json (final, with LLM-tagged attributes).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { llmJSON } from './llm.mjs';
import { PALETTE, hexToFamily } from '../lib/palette.mjs';

const execFileP = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const RAW_PATH = path.join(DATA_DIR, 'catalog-raw.jsonl');
const OUT_PATH = path.join(DATA_DIR, 'catalog.json');

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : null;
const SKIP_TAG = args.includes('--skip-tag');
const TAG_ONLY = args.includes('--tag-only');
const REFRESH = args.includes('--refresh');

const BASE = 'https://www.nuuly.com';
const SEED = 20260703;

// The sitemap declares a 1s crawl-delay; stay above it, with jitter so the
// request train doesn't look metronomic to the bot detector.
const throttle = () => sleep(1200 + Math.random() * 800);

// Full browser header set — Nuuly's bot protection (DataDome) 403s bare requests.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// How many items we want per slot in the seeded catalog (~1,200 total).
const QUOTAS = { top: 320, bottom: 280, dress: 240, onepiece: 80, outerwear: 160, layer: 140 };

// nuulyClass facet → slot. Values discovered during harvest; unknown classes
// are logged and skipped (swim, sleep, accessories, men's, ...).
function slotFromClass(nuulyClass, title) {
  const c = (nuulyClass || '').toLowerCase();
  const t = (title || '').toLowerCase();
  const isCardigan = /cardigan|shrug|bolero/.test(t);
  if (c.includes('top')) return { slot: 'top', altSlot: null };
  if (c.includes('bottom') || c.includes('pant') || c.includes('jean') || c.includes('skirt') || c.includes('short'))
    return { slot: 'bottom', altSlot: null };
  if (c.includes('dress')) return { slot: 'dress', altSlot: null };
  if (c.includes('jumpsuit') || c.includes('romper')) return { slot: 'onepiece', altSlot: null };
  if (c.includes('jacket') || c.includes('coat') || c.includes('blazer') || c.includes('outerwear'))
    return { slot: 'outerwear', altSlot: null };
  if (c.includes('sweater') || c.includes('sweatshirt') || c.includes('knit'))
    return isCardigan ? { slot: 'layer', altSlot: null } : { slot: 'top', altSlot: 'layer' };
  return null;
}

// Slug keyword guess — used only to prioritize which URLs to fetch so we don't
// burn requests on categories whose quota is already full. The embedded
// nuulyClass facet is authoritative after fetch.
function guessSlotFromSlug(slug) {
  const s = slug.toLowerCase();
  if (/cardigan|shrug|bolero/.test(s)) return 'layer';
  if (/jumpsuit|romper|overall|boilersuit/.test(s)) return 'onepiece';
  if (/jacket|coat|blazer|parka|trench|puffer|anorak|windbreaker/.test(s)) return 'outerwear';
  if (/dress|gown/.test(s)) return 'dress';
  if (/jean|pant|trouser|skirt|short|legging|culotte|chino/.test(s)) return 'bottom';
  if (/top|tee|tank|blouse|shirt|cami|bodysuit|sweater|pullover|hoodie|sweatshirt|turtleneck|polo|henley|vest/.test(s))
    return 'top';
  return null;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch via curl rather than Node's fetch: Nuuly's DataDome bot protection
// fingerprints TLS clients, and undici's fingerprint gets 403'd where curl's
// passes. A cookie jar keeps the DataDome session cookie so we look like one
// returning browser — BUT a flagged datadome cookie keeps you blocked forever,
// so the jar is thrown away on any 403 before backing off and retrying.
const COOKIE_JAR = path.join(DATA_DIR, '.dd-cookies.txt');

class FetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status; // HTTP status, or 0 for network-level failures
  }
}

async function fetchPage(url, attempt = 0) {
  const curlArgs = [
    '-s', '--compressed', '-L', '--max-time', '30',
    '-c', COOKIE_JAR, '-b', COOKIE_JAR,
    '-w', '\n%{http_code}',
    ...Object.entries(HEADERS).flatMap(([k, v]) => ['-H', `${k}: ${v}`]),
    url,
  ];

  let stdout;
  try {
    ({ stdout } = await execFileP('curl', curlArgs, { maxBuffer: 32 * 1024 * 1024 }));
  } catch (err) {
    // curl exited non-zero: connection reset, DNS blip, timeout. Back off and
    // retry; drop the session cookie on later attempts in case it was flagged
    // mid-connection.
    if (attempt < 4) {
      if (attempt >= 1) fs.rmSync(COOKIE_JAR, { force: true });
      const backoff = 15_000 * (attempt + 1);
      console.warn(`  … curl failed (exit ${err.code}), retry in ${backoff / 1000}s`);
      await sleep(backoff);
      return fetchPage(url, attempt + 1);
    }
    throw new FetchError(`network failure (curl exit ${err.code}) for ${url}`, 0);
  }

  const cut = stdout.lastIndexOf('\n');
  const status = Number(stdout.slice(cut + 1));
  const body = stdout.slice(0, cut);
  if (status >= 200 && status < 300) return body;
  if (attempt < 3 && (status === 403 || status === 429 || status >= 500)) {
    // A flagged DataDome cookie keeps you blocked forever — always start a
    // fresh session before retrying a 403/429.
    if (status === 403 || status === 429) fs.rmSync(COOKIE_JAR, { force: true });
    const backoff = status === 403 || status === 429 ? 60_000 * (attempt + 1) : 10_000;
    console.warn(`  … HTTP ${status}, dropping session + backing off ${backoff / 1000}s`);
    await sleep(backoff);
    return fetchPage(url, attempt + 1);
  }
  throw new FetchError(`HTTP ${status} for ${url}`, status);
}

const SITEMAP_CACHE = path.join(DATA_DIR, '.sitemap-cache.json');

async function fetchSitemapSlugs() {
  if (fs.existsSync(SITEMAP_CACHE)) {
    const cached = JSON.parse(fs.readFileSync(SITEMAP_CACHE, 'utf8'));
    if (Date.now() - cached.at < 24 * 3600 * 1000) {
      console.log(`(using sitemap cache from ${new Date(cached.at).toISOString()})`);
      return cached.slugs;
    }
  }
  const slugs = new Set();
  for (let page = 1; page <= 20; page++) {
    let xml;
    try {
      xml = await fetchPage(`${BASE}/rent/products_sitemap.xml?page=${page}`);
    } catch (err) {
      // The server 500s on out-of-range pages — that's the end of the sitemap.
      if (page > 1) break;
      throw err;
    }
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (locs.length === 0) break;
    const before = slugs.size;
    for (const loc of locs) {
      const m = loc.match(/\/rent\/products\/([^/?#]+)/);
      if (m) slugs.add(m[1]);
    }
    if (slugs.size === before) break; // page repeated — done
    await throttle();
  }
  fs.writeFileSync(SITEMAP_CACHE, JSON.stringify({ at: Date.now(), slugs: [...slugs] }));
  return [...slugs];
}

function parseProduct(html, slug) {
  const m = html.match(/<script type="mime\/invalid" id="initialState">([\s\S]*?)<\/script>/);
  if (!m) return { skip: 'no initialState' };
  let state;
  try {
    state = JSON.parse(JSON.parse(m[1]));
  } catch {
    return { skip: 'unparseable initialState' };
  }
  const key = Object.keys(state).find((k) => k.startsWith('product--'));
  const pd = key && state[key]?.productDetails;
  if (!pd) return { skip: 'no productDetails' };
  if (pd.removeForLegalReasons) return { skip: 'legal' };
  if (pd.isAvailable === false || pd.isPublished === false) return { skip: 'unavailable' };

  const facets = pd.facets || {};
  const dept = (facets.nuulyDepartment || []).join(' ');
  if (/men/i.test(dept) && !/women/i.test(dept)) return { skip: `mens (${dept})` };

  const nuulyClass = (facets.nuulyClass || [])[0] || null;
  const title = pd.displayName || slug;
  if (/maternity/i.test(dept) || /\bmaternity\b/i.test(title)) return { skip: 'maternity' };
  const mapped = slotFromClass(nuulyClass, title);
  if (!mapped) return { skip: `unmapped class: ${nuulyClass}` };

  const choice = (pd.choices || [])[0];
  const images = choice?.imageUrls || [];
  if (!images.length) return { skip: 'no images' };

  const desc = (pd.additionalDescription || '')
    .split('\n')
    .map((l) => l.replace(/^\*\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('; ')
    .slice(0, 320);

  return {
    item: {
      id: String(pd.styleNumber || pd.productId || slug),
      slug,
      url: `${BASE}/rent/products/${slug}`,
      title,
      brand: pd.brandUrls?.[0]?.displayName || null,
      retail: typeof pd.msrpValue === 'number' ? pd.msrpValue : null,
      category: nuulyClass,
      slot: mapped.slot,
      altSlot: mapped.altSlot,
      color: choice?.color
        ? { name: choice.color.displayName || null, hex: choice.color.hexCode || null }
        : null,
      image: images[0],
      images: images.slice(0, 4),
      facets: {
        fabric: facets.fabric || [],
        patterns: facets.patterns || [],
        occasions: facets.occasions || [],
        silhouettes: facets.silhouettes || [],
        weather: facets.weather || [],
        sleeve: facets.sleeve || [],
        length: facets.length || [],
      },
      desc,
      harvestedAt: new Date().toISOString().slice(0, 10),
    },
  };
}

function loadRaw() {
  if (REFRESH || !fs.existsSync(RAW_PATH)) return [];
  return fs
    .readFileSync(RAW_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function harvest() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const items = loadRaw();
  const seen = new Set(items.map((i) => i.slug));
  const counts = Object.fromEntries(Object.keys(QUOTAS).map((s) => [s, 0]));
  for (const it of items) counts[it.slot] = (counts[it.slot] || 0) + 1;

  const target = LIMIT ?? Object.values(QUOTAS).reduce((a, b) => a + b, 0);
  if (items.length >= target) {
    console.log(`raw catalog already has ${items.length} items (target ${target}) — skipping fetch`);
    return items;
  }

  console.log('fetching sitemap…');
  const slugs = await fetchSitemapSlugs();
  console.log(`sitemap: ${slugs.length} product urls`);

  // Stratify by slug-guessed slot so we fetch roughly what the quotas need.
  const rand = mulberry32(SEED);
  const pools = { unknown: [] };
  for (const s of Object.keys(QUOTAS)) pools[s] = [];
  for (const slug of shuffle(slugs, rand)) {
    if (seen.has(slug)) continue;
    const guess = guessSlotFromSlug(slug);
    (pools[guess] ?? pools.unknown).push(slug);
  }

  const quotaFor = (slot) =>
    LIMIT ? Math.ceil((QUOTAS[slot] / Object.values(QUOTAS).reduce((a, b) => a + b, 0)) * LIMIT) : QUOTAS[slot];

  const skips = {};
  const unmappedClasses = new Set();
  let fetched = 0;
  let consecutiveErrors = 0;
  const raw = fs.createWriteStream(RAW_PATH, { flags: 'a' });

  const nextSlug = () => {
    // Pick the pool for the most under-filled slot; fall back to unknown.
    const open = Object.keys(QUOTAS)
      .filter((s) => counts[s] < quotaFor(s))
      .sort((a, b) => counts[a] / quotaFor(a) - counts[b] / quotaFor(b));
    for (const s of open) if (pools[s].length) return pools[s].pop();
    if (pools.unknown.length) return pools.unknown.pop();
    for (const s of Object.keys(QUOTAS)) if (pools[s].length) return pools[s].pop();
    return null;
  };

  while (items.length < target) {
    const done = Object.keys(QUOTAS).every((s) => counts[s] >= quotaFor(s));
    if (done) break;
    const slug = nextSlug();
    if (!slug) break;

    await throttle();
    let html;
    try {
      html = await fetchPage(`${BASE}/rent/products/${slug}`);
      consecutiveErrors = 0;
    } catch (err) {
      if (err.status === 404) {
        skips.gone = (skips.gone || 0) + 1; // stale sitemap entry — normal
        continue;
      }
      consecutiveErrors++;
      skips.fetchError = (skips.fetchError || 0) + 1;
      console.warn(`  ! ${slug}: ${err.message}`);
      if (consecutiveErrors >= 15) throw new Error('15 consecutive fetch failures — aborting');
      continue;
    }
    fetched++;

    const { item, skip } = parseProduct(html, slug);
    if (skip) {
      skips[skip.split(':')[0]] = (skips[skip.split(':')[0]] || 0) + 1;
      if (skip.startsWith('unmapped')) unmappedClasses.add(skip);
      continue;
    }
    if (counts[item.slot] >= quotaFor(item.slot)) {
      skips.quotaFull = (skips.quotaFull || 0) + 1;
      continue;
    }
    items.push(item);
    counts[item.slot]++;
    seen.add(slug);
    raw.write(JSON.stringify(item) + '\n');

    if (items.length % 25 === 0 || items.length === target) {
      console.log(
        `  ${items.length}/${target} accepted (${fetched} fetched) — ` +
          Object.entries(counts).map(([s, n]) => `${s}:${n}`).join(' '),
      );
    }
  }
  raw.end();

  console.log(`\nharvest done: ${items.length} items from ${fetched} fetches`);
  console.log('slots:', counts);
  if (Object.keys(skips).length) console.log('skips:', skips);
  if (unmappedClasses.size) console.log('unmapped classes seen:', [...unmappedClasses]);
  return items;
}

// ---------------------------------------------------------------------------
// LLM attribute tagging: palette / formality / statement / fit per item.
// Batched; results merged into the final catalog.json.
// ---------------------------------------------------------------------------

const TAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'palette', 'formality', 'statement', 'fit'],
        properties: {
          id: { type: 'string' },
          palette: { type: 'array', items: { type: 'string', enum: PALETTE } },
          formality: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          statement: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          fit: { type: 'string', enum: ['fitted', 'relaxed', 'oversized'] },
        },
      },
    },
  },
};

const TAG_SYSTEM = `You are a fashion catalog tagger. For each garment you receive, assign:
- palette: 1-3 color families from the allowed list that describe the garment's dominant colors (use the color name, pattern, and description; "multi" only for busy multicolor prints)
- formality: 1 = beachwear/loungewear, 2 = casual everyday, 3 = smart casual, 4 = office/cocktail, 5 = black tie
- statement: 1 = plain basic, 3 = noticeable, 5 = show-stopping loud piece (bold print, sequins, dramatic silhouette)
- fit: fitted (bodycon, slim, tailored close), relaxed (regular/easy), oversized (boxy, voluminous, slouchy)
Judge from the metadata provided. Return one entry per input id, same ids.`;

async function tagItems(items) {
  const untagged = items.filter((i) => !i.palette);
  if (!untagged.length) return items;
  console.log(`\ntagging ${untagged.length} items via LLM…`);

  const BATCH = 30;
  const tagged = new Map();
  for (let off = 0; off < untagged.length; off += BATCH) {
    const batch = untagged.slice(off, off + BATCH);
    const prompt = batch
      .map((i) =>
        JSON.stringify({
          id: i.id,
          title: i.title,
          category: i.category,
          color: i.color?.name,
          fabric: i.facets.fabric,
          patterns: i.facets.patterns,
          occasions: i.facets.occasions,
          silhouettes: i.facets.silhouettes,
          desc: i.desc,
        }),
      )
      .join('\n');
    try {
      const res = await llmJSON({ system: TAG_SYSTEM, prompt, schema: TAG_SCHEMA });
      for (const t of res.items || []) tagged.set(String(t.id), t);
      console.log(`  tagged ${Math.min(off + BATCH, untagged.length)}/${untagged.length}`);
    } catch (err) {
      console.warn(`  ! batch at ${off} failed: ${err.message}`);
    }
  }

  for (const item of items) {
    const t = tagged.get(item.id);
    if (t) {
      // Union the LLM's palette with the family derived from the actual hex
      // swatch, so solid items always carry their true base color.
      const hexFam = hexToFamily(item.color?.hex);
      item.palette = [...new Set([...(hexFam ? [hexFam] : []), ...t.palette])];
      item.formality = t.formality;
      item.statement = t.statement;
      item.fit = t.fit;
    }
  }
  const missing = items.filter((i) => !i.palette).length;
  if (missing) console.warn(`${missing} items left untagged (re-run with --tag-only to retry)`);
  return items;
}

async function main() {
  const items = TAG_ONLY ? loadRaw() : await harvest();
  if (!items.length) throw new Error('no items harvested');
  // Carry over tags already written to catalog.json so an interrupted tagging
  // pass resumes instead of re-tagging (and re-billing) everything.
  if (!SKIP_TAG && fs.existsSync(OUT_PATH)) {
    const prev = new Map(JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).items.map((i) => [i.id, i]));
    for (const item of items) {
      const p = prev.get(item.id);
      if (p?.palette && !item.palette) {
        Object.assign(item, {
          palette: p.palette, formality: p.formality, statement: p.statement, fit: p.fit,
        });
      }
    }
  }
  const finalItems = SKIP_TAG ? items : await tagItems(items);
  fs.writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        source: 'nuuly.com products sitemap (one-time seeded harvest)',
        harvestedAt: new Date().toISOString().slice(0, 10),
        count: finalItems.length,
        items: finalItems,
      },
      null,
      1,
    ),
  );
  console.log(`\nwrote ${OUT_PATH} (${finalItems.length} items)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
