// Catalog loading + per-slot candidate retrieval.
//
// Retrieval scores each item against the expanded vibe with
//   0.5 · attributeMatch  +  0.5 · CLIP(slot hint text → product image)
// and hands the top of each slot pool to the stylist, which does the actual
// outfit assembly under hand-written rules (lib/stylist.js).
import fs from 'node:fs';
import path from 'node:path';
import { cosine } from './embed.js';
import { NEUTRALS } from './palette.mjs';

let cache = null;

export function loadCatalog() {
  if (cache) return cache;
  const root = process.cwd();
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'));
  let vectors = {};
  try {
    vectors = JSON.parse(fs.readFileSync(path.join(root, 'data', 'embeddings.json'), 'utf8')).vectors;
  } catch {
    // embeddings are optional in pipeline-v1; retrieval falls back to attributes only
  }
  const items = catalog.items
    .filter((i) => i.palette && i.formality) // only fully tagged items
    .map((i) => ({ ...i, emb: vectors[i.id] || null, text: itemText(i) }));
  cache = { harvestedAt: catalog.harvestedAt, source: catalog.source, items };
  return cache;
}

// Closet filters (menubar → request body) are hard constraints applied before
// retrieval, straight off the harvested Nuuly facets — no LLM involved.
// Weather: every item carries facets.weather; "Year-Round" passes either pick.
// Occasion: matched case-insensitively against facets.occasions.
const WEATHER_FACET = { warm: 'Warm Weather', cold: 'Cold Weather' };
export const OCCASION_FILTERS = new Set(['casual', 'going out', 'work', 'cocktail', 'formal', 'lounge']);

export function filterCloset(items, filters = {}) {
  let out = items;
  const wanted = WEATHER_FACET[filters.weather];
  if (wanted) {
    out = out.filter((i) => {
      const w = i.facets?.weather ?? [];
      return w.includes(wanted) || w.includes('Year-Round');
    });
  }
  if (OCCASION_FILTERS.has(filters.occasion)) {
    out = out.filter((i) =>
      (i.facets?.occasions ?? []).some((o) => o.toLowerCase() === filters.occasion),
    );
  }
  return out;
}

function itemText(i) {
  return [
    i.title, i.brand, i.category, i.desc, i.color?.name,
    ...Object.values(i.facets || {}).flat(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

// How well one garment matches the vibe's attributes, 0..1.
export function attributeMatch(attrs, item) {
  const pal = new Set(item.palette);
  const wants = attrs.palette.filter((f) => pal.has(f)).length;
  let palette = wants > 0 ? 1 : [...pal].some((f) => NEUTRALS.has(f)) ? 0.5 : 0.1;
  if (attrs.avoid?.some((f) => pal.has(f))) palette = Math.max(0, palette - 0.5);

  const formality = 1 - Math.abs(item.formality - attrs.formality) / 4;

  const statement =
    item.statement <= attrs.statementTolerance
      ? 1
      : Math.max(0, 1 - 0.4 * (item.statement - attrs.statementTolerance));

  const ORDER = ['fitted', 'relaxed', 'oversized'];
  const fit =
    attrs.fit === 'mixed'
      ? 0.7
      : item.fit === attrs.fit
        ? 1
        : Math.abs(ORDER.indexOf(item.fit) - ORDER.indexOf(attrs.fit)) === 1
          ? 0.5
          : 0.2;

  const hits = attrs.keywords.filter((k) => item.text.includes(k)).length;
  const keywords = Math.min(1, hits * 0.5);

  return 0.3 * palette + 0.25 * formality + 0.1 * statement + 0.15 * fit + 0.2 * keywords;
}

// Top candidates for one slot, scored against the vibe. hintEmb is the CLIP
// embedding of the vibe's slot hint ("cream cable-knit turtleneck sweater").
export function candidatesForSlot(items, slot, attrs, hintEmb, { exclude = new Set(), poolSize = 15 } = {}) {
  const pool = items.filter((i) => (i.slot === slot || i.altSlot === slot) && !exclude.has(i.id));
  const withAttr = pool.map((item) => ({
    item,
    attr: attributeMatch(attrs, item),
    clip: hintEmb && item.emb ? cosine(hintEmb, item.emb) : null,
  }));

  // CLIP text→image cosines live in a narrow absolute range; min-max normalize
  // within the pool so the two score halves are comparable.
  const clips = withAttr.map((c) => c.clip).filter((c) => c !== null);
  const lo = Math.min(...clips), hi = Math.max(...clips);
  const span = hi - lo || 1;

  return withAttr
    .map((c) => ({
      ...c.item,
      vibeScore: c.clip === null ? c.attr : 0.5 * c.attr + 0.5 * ((c.clip - lo) / span),
    }))
    .sort((a, b) => b.vibeScore - a.vibeScore)
    .slice(0, poolSize);
}
