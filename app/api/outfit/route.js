// Orchestration: expand vibe (LLM #1) → retrieve per-slot candidates (local
// attribute + CLIP scoring) → assemble under stylist rules (pure local math)
// → explain the chosen looks (LLM #2). Exactly two model calls per request.
import { expandVibe } from '@/lib/search';
import { loadCatalog, candidatesForSlot, filterCloset, OCCASION_FILTERS } from '@/lib/catalog';
import { assembleOutfits } from '@/lib/stylist';
import { explainOutfits } from '@/lib/explain';
import { embedTexts } from '@/lib/embed';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const t0 = Date.now();

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Send JSON: {"vibe": "...", "budget"?: number}' }, { status: 400 });
  }

  const vibe = String(body.vibe ?? '').trim().slice(0, 300);
  if (!vibe) {
    return Response.json({ error: 'Tell the computer a vibe first.' }, { status: 400 });
  }
  const budget = Number(body.budget) > 0 ? Number(body.budget) : null;
  const exclude = new Set(Array.isArray(body.excludeIds) ? body.excludeIds.map(String) : []);
  // Closet filters: whitelist-validated, anything unrecognized is ignored.
  const filters = {
    weather: ['warm', 'cold'].includes(body.filters?.weather) ? body.filters.weather : 'any',
    occasion: OCCASION_FILTERS.has(body.filters?.occasion) ? body.filters.occasion : 'any',
  };

  try {
    const attrs = await expandVibe(vibe);
    const { items: allItems, harvestedAt } = loadCatalog();
    const items = filterCloset(allItems, filters);

    const needed = new Set();
    if (attrs.base !== 'separates') needed.add('dress').add('onepiece');
    if (attrs.base !== 'dress') needed.add('top').add('bottom');
    if (attrs.outerwear) needed.add('outerwear');
    if (attrs.layer) needed.add('layer');
    const slots = [...needed];

    const hintEmbs = await embedTexts(
      slots.map((s) => `a product photo of ${attrs.slotHints[s]}`),
    );
    const pools = {};
    slots.forEach((s, i) => {
      pools[s] = candidatesForSlot(items, s, attrs, hintEmbs[i], { exclude });
    });

    let outfits = assembleOutfits({ pools, attrs, budget });
    outfits = await explainOutfits(vibe, outfits);

    return Response.json({
      vibe,
      attributes: attrs,
      filters,
      catalog: { count: allItems.length, pool: items.length, harvestedAt },
      outfits: outfits.map(publicOutfit),
      tookMs: Date.now() - t0,
    });
  } catch (err) {
    console.error('outfit route failed:', err);
    return Response.json(
      { error: 'The wardrobe computer crashed. Check the server logs (is ANTHROPIC_API_KEY set?).' },
      { status: 500 },
    );
  }
}

function publicOutfit(o) {
  return {
    name: o.name,
    note: o.note,
    totalRetail: o.totalRetail,
    score: Number(o.score.toFixed(3)),
    report: o.report,
    items: o.items.map((i, idx) => ({
      id: i.id,
      slot: o.slots[idx],
      title: i.title,
      brand: i.brand,
      retail: i.retail,
      url: i.url,
      image: i.image,
      color: i.color,
      fit: i.fit,
      statement: i.statement,
      palette: i.palette,
      weather: i.facets?.weather ?? [],
      occasions: i.facets?.occasions ?? [],
    })),
  };
}
