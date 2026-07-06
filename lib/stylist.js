// THE DIFFERENTIATOR. Hand-written outfit assembly — no LLM anywhere in this
// file. Embedding similarity and attribute matching only *nominate* candidates
// (lib/catalog.js); the rules here decide what actually gets worn together.
//
// Slot system (Nuuly-adapted — no shoes/accessories, Nuuly doesn't rent them):
//   base     = top + bottom  OR  dress | onepiece (jumpsuit/romper)
//   outerwear (jacket/coat/blazer) when the vibe calls for it
//   layer     (sweater/cardigan) optional, when the vibe implies it
//
// Rules enforced on every combination:
//   HARD  one statement piece max (statement ≥ 4)
//   HARD  never all-oversized; a base of two pieces can't both be oversized
//   HARD  palette coherence: a family shared by every piece, or neutrals
//         throughout (relaxed with a penalty only if nothing passes)
//   HARD  formality spread ≤ 1 (relaxed to ≤ 2 with penalty if nothing passes)
//   HARD  budget: summed retail value ≤ cap, when given
//   BAND  pairwise visual coherence: mean CLIP cosine between the chosen
//         product images must land in a target band — too low reads as a
//         clash, too high as matchy-matchy
//   BONUS oversized ↔ fitted pairing (deliberate proportion play)
import { cosine } from './embed.js';
import { NEUTRALS } from './palette.mjs';

// CLIP image↔image cosines for apparel product shots (same white-studio
// framing) run high — calibrated on the full 1,222-item harvested catalog,
// where random image pairs land at p1 0.59 / p10 0.71 / median 0.79 /
// p90 0.85 / p99 0.89. Below LOW the pieces visually clash; above HIGH the
// outfit is near-twins.
export const COHERENCE_BAND = { low: 0.68, high: 0.85 };

const WEIGHTS = { vibe: 0.55, coherence: 0.3, palette: 0.15 };

export function assembleOutfits({ pools, attrs, budget = null, count = 3 }) {
  const plans = buildPlans(attrs, pools);

  // Pass 1: full rules. Pass 2 (only if pass 1 yields nothing): relax the
  // palette and formality constraints with a score penalty, so a weak catalog
  // region degrades gracefully instead of returning "AS IF!" for everything.
  let combos = enumerate(plans, pools, attrs, budget, { relaxed: false });
  if (combos.length === 0) {
    combos = enumerate(plans, pools, attrs, budget, { relaxed: true });
  }
  combos.sort((a, b) => b.score - a.score);

  return pickDistinct(combos, count);
}

function buildPlans(attrs, pools) {
  const has = (slot) => (pools[slot] || []).length > 0;
  const bases = [];
  if (attrs.base !== 'separates') {
    if (has('dress')) bases.push(['dress']);
    if (has('onepiece')) bases.push(['onepiece']);
  }
  if (attrs.base !== 'dress' && has('top') && has('bottom')) bases.push(['top', 'bottom']);
  if (bases.length === 0 && has('top') && has('bottom')) bases.push(['top', 'bottom']);

  const extras = [];
  if (attrs.outerwear && has('outerwear')) extras.push('outerwear');
  if (attrs.layer && has('layer')) extras.push('layer');

  return bases.map((base) => [...base, ...extras]);
}

function enumerate(plans, pools, attrs, budget, { relaxed }) {
  const out = [];
  for (const plan of plans) {
    const slotPools = plan.map((slot) => pools[slot].map((item) => ({ slot, item })));
    walk(slotPools, 0, [], (picks) => {
      const combo = evaluate(picks, attrs, budget, relaxed);
      if (combo) out.push(combo);
    });
  }
  return out;
}

function walk(slotPools, depth, acc, emit) {
  if (depth === slotPools.length) {
    emit(acc);
    return;
  }
  for (const pick of slotPools[depth]) {
    // A sweater nominated for both "top" and "layer" must not appear twice.
    if (acc.some((p) => p.item.id === pick.item.id)) continue;
    acc.push(pick);
    walk(slotPools, depth + 1, acc, emit);
    acc.pop();
  }
}

function evaluate(picks, attrs, budget, relaxed) {
  const items = picks.map((p) => p.item);

  // --- budget (hard) ---
  const totalRetail = items.reduce((s, i) => s + (i.retail || 0), 0);
  if (budget && totalRetail > budget) return null;

  // --- one statement max (hard) ---
  const statements = items.filter((i) => i.statement >= 4);
  if (statements.length > 1) return null;

  // --- fit balance ---
  const fits = items.map((i) => i.fit);
  if (fits.every((f) => f === 'oversized')) return null;
  const base = picks.filter((p) => ['top', 'bottom', 'dress', 'onepiece'].includes(p.slot));
  if (base.length === 2 && base.every((p) => p.item.fit === 'oversized')) return null;
  const proportionPlay = fits.includes('oversized') && fits.includes('fitted') ? 0.05 : 0;

  // --- palette coherence ---
  const paletteSets = items.map((i) => new Set(i.palette));
  let shared = [...paletteSets[0]].filter((f) => paletteSets.every((s) => s.has(f)));
  const allNeutralAnchored = paletteSets.every((s) => [...s].some((f) => NEUTRALS.has(f)));
  let paletteScore;
  if (shared.some((f) => !NEUTRALS.has(f))) paletteScore = 1;
  else if (shared.length > 0) paletteScore = 0.85;
  else if (allNeutralAnchored) paletteScore = 0.6;
  else if (relaxed) paletteScore = 0.2;
  else return null;

  // --- formality spread ---
  const formalities = items.map((i) => i.formality);
  const spread = Math.max(...formalities) - Math.min(...formalities);
  if (spread > (relaxed ? 2 : 1)) return null;
  const formalityPenalty = spread === 2 ? 0.1 : 0;

  // --- pairwise visual coherence band ---
  const coherence = meanPairwiseCosine(items);
  let coherenceScore = 0.5; // neutral when embeddings are missing (pipeline v1)
  if (coherence !== null) {
    if (coherence < COHERENCE_BAND.low) {
      coherenceScore = Math.max(0, 1 - (COHERENCE_BAND.low - coherence) / 0.1);
    } else if (coherence > COHERENCE_BAND.high) {
      coherenceScore = Math.max(0, 1 - (coherence - COHERENCE_BAND.high) / 0.06);
    } else {
      coherenceScore = 1;
    }
  }

  const vibeScore = items.reduce((s, i) => s + i.vibeScore, 0) / items.length;

  const score =
    WEIGHTS.vibe * vibeScore +
    WEIGHTS.coherence * coherenceScore +
    WEIGHTS.palette * paletteScore +
    proportionPlay -
    formalityPenalty -
    (relaxed ? 0.15 : 0);

  return {
    slots: picks.map((p) => p.slot),
    items,
    totalRetail,
    score,
    report: {
      coherence: coherence === null ? null : Number(coherence.toFixed(3)),
      sharedFamilies: shared,
      neutralAnchored: allNeutralAnchored,
      statementPiece: statements[0]?.title ?? null,
      formalitySpread: spread,
      fitMix: fits,
      relaxedRules: relaxed,
    },
  };
}

function meanPairwiseCosine(items) {
  const embs = items.map((i) => i.emb).filter(Boolean);
  if (embs.length < 2) return null;
  let sum = 0, n = 0;
  for (let a = 0; a < embs.length; a++) {
    for (let b = a + 1; b < embs.length; b++) {
      sum += cosine(embs[a], embs[b]);
      n++;
    }
  }
  return sum / n;
}

// Diversity-aware selection (MMR). Picking the top-N score-ordered combos makes
// the three looks collapse onto near-twins for a narrow vibe (three different
// white-linen "coastal grandma" outfits). Instead: pick #1 is the best match;
// each later pick maximizes score − λ·(similarity to an already-picked look), so
// the looks span the *range* of the vibe. Item-disjointness is still preferred
// and loosens only when the pool can't supply disjoint looks.
const DIVERSITY_LAMBDA = 0.22;
// Cross-outfit CLIP cosines live in the same compressed apparel range as the
// coherence band; rescale [band.low … TWIN] to [0 … 1] before penalizing.
const TWIN_COSINE = 0.88;

function pickDistinct(combos, count) {
  if (!combos.length) return [];
  // Deeper-than-top-400 combos can't out-score a top pick even with the
  // diversity bonus; cap the MMR candidate set so selection stays cheap.
  const pool = combos.slice(0, 400);
  const picked = [combos[0]];

  while (picked.length < count) {
    let best = null;
    let bestVal = -Infinity;
    for (let allowShared = 0; allowShared <= 2 && !best; allowShared++) {
      for (const combo of pool) {
        if (picked.includes(combo)) continue;
        if (itemOverlap(combo, picked) > allowShared) continue;
        const sim = Math.max(...picked.map((p) => outfitSimilarity(combo, p)));
        const val = combo.score - DIVERSITY_LAMBDA * sim;
        if (val > bestVal) {
          bestVal = val;
          best = combo;
        }
      }
    }
    if (!best) break;
    picked.push(best);
  }

  // Safety net: if the capped pool couldn't supply `count` disjoint looks, fall
  // back to the plain score-ordered fill over every combo (original behavior).
  for (let allowShared = 0; allowShared <= 2 && picked.length < count; allowShared++) {
    for (const combo of combos) {
      if (picked.length >= count) break;
      if (!picked.includes(combo) && itemOverlap(combo, picked) <= allowShared) picked.push(combo);
    }
  }
  return picked;
}

function itemOverlap(combo, picked) {
  return picked.reduce(
    (m, p) => Math.max(m, p.items.filter((i) => combo.items.some((j) => j.id === i.id)).length),
    0,
  );
}

// How alike two assembled looks are, 0 (distinct) … 1 (twins): a blend of visual
// similarity (mean cross-image CLIP cosine) and palette overlap (Jaccard of
// families). Palette-only when embeddings are absent (pipeline v1).
function outfitSimilarity(a, b) {
  const fa = new Set(a.items.flatMap((i) => i.palette || []));
  const fb = new Set(b.items.flatMap((i) => i.palette || []));
  const inter = [...fa].filter((f) => fb.has(f)).length;
  const paletteJaccard = inter / (new Set([...fa, ...fb]).size || 1);

  const ea = a.items.map((i) => i.emb).filter(Boolean);
  const eb = b.items.map((i) => i.emb).filter(Boolean);
  if (!ea.length || !eb.length) return paletteJaccard;
  let sum = 0;
  let n = 0;
  for (const x of ea) for (const y of eb) { sum += cosine(x, y); n++; }
  const visual = Math.min(1, Math.max(0, (sum / n - COHERENCE_BAND.low) / (TWIN_COSINE - COHERENCE_BAND.low)));
  return 0.65 * visual + 0.35 * paletteJaccard;
}
