// Vibe text → structured, queryable attributes. THE one place the "what does
// this vibe mean in clothes" prompt lives. Single LLM call per request;
// everything downstream (retrieval + assembly) is local math against the
// attributes this returns.
import { llmJSON } from './llm.js';
import { PALETTE } from './palette.mjs';

const ATTRS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'palette', 'avoid', 'formality', 'statementTolerance', 'fit', 'base',
    'layer', 'outerwear', 'keywords', 'slotHints',
  ],
  properties: {
    palette: { type: 'array', items: { type: 'string', enum: PALETTE } },
    avoid: { type: 'array', items: { type: 'string', enum: PALETTE } },
    formality: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    statementTolerance: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    fit: { type: 'string', enum: ['fitted', 'relaxed', 'oversized', 'mixed'] },
    base: { type: 'string', enum: ['dress', 'separates', 'either'] },
    layer: { type: 'boolean' },
    outerwear: { type: 'boolean' },
    keywords: { type: 'array', items: { type: 'string' } },
    slotHints: {
      type: 'object',
      additionalProperties: false,
      required: ['top', 'bottom', 'dress', 'onepiece', 'outerwear', 'layer'],
      properties: {
        top: { type: 'string' },
        bottom: { type: 'string' },
        dress: { type: 'string' },
        onepiece: { type: 'string' },
        outerwear: { type: 'string' },
        layer: { type: 'string' },
      },
    },
  },
};

const SYSTEM = `You are a fashion stylist's intake assistant. Turn a free-text "vibe" into concrete, queryable garment attributes for a women's rental wardrobe (tops, bottoms, dresses, jumpsuits, outerwear, sweaters — no shoes or accessories).

Fields:
- palette: 2-5 color families that define the vibe's palette
- avoid: color families that would break the vibe (often empty)
- formality: 1 loungewear/beach … 2 casual … 3 smart casual … 4 office/cocktail … 5 black tie
- statementTolerance: how loud the loudest piece may be (1 all-basics … 5 sequins welcome)
- fit: the vibe's dominant silhouette; "mixed" if it plays fitted against loose
- base: "dress" if the vibe wants a one-piece foundation, "separates" for top+bottom, "either" when both could work
- layer: true if the vibe implies a knit layer (cozy, academia, autumnal, chilly…)
- outerwear: true unless the vibe is clearly warm-weather/indoors and a jacket would be dead weight
- keywords: up to 8 lowercase material/construction/style words likely to appear in product titles or fabric facets (e.g. "tweed", "plaid", "linen", "leather", "cargo", "slip")
- slotHints: for EACH slot, one short CLIP-style photo caption of the ideal garment for this vibe, as if captioning a product photo (e.g. top: "cream cable-knit turtleneck sweater"). Always fill all six, even slots unlikely to be used.

Interpret weather cues ("rain-proof" → water-resistant outerwear keywords), budget cues are handled elsewhere. Be specific and opinionated; never refuse a vibe — gibberish gets your best aesthetic guess.`;

export async function expandVibe(vibe) {
  const attrs = await llmJSON({
    system: SYSTEM,
    prompt: `Vibe: ${JSON.stringify(vibe)}`,
    schema: ATTRS_SCHEMA,
    maxTokens: 2000,
  });
  attrs.keywords = (attrs.keywords || []).map((k) => k.toLowerCase()).slice(0, 8);
  return attrs;
}
