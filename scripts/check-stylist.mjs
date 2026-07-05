#!/usr/bin/env node
// Stylist rule-engine checks against fixture vibes — no LLM calls. The vibe
// attributes below are frozen copies of what lib/search.js would produce, so
// this runs offline and fails loudly if an assembly rule regresses.
//
//   node scripts/check-stylist.mjs
import { loadCatalog, candidatesForSlot } from '../lib/catalog.js';
import { assembleOutfits } from '../lib/stylist.js';
import { embedTexts } from '../lib/embed.js';
import { NEUTRALS } from '../lib/palette.mjs';

const FIXTURES = [
  {
    name: 'dark academia (separates, layered)',
    budget: null,
    attrs: {
      palette: ['brown', 'black', 'burgundy', 'cream', 'olive'],
      avoid: ['pink', 'orange'],
      formality: 3,
      statementTolerance: 3,
      fit: 'mixed',
      base: 'either',
      layer: true,
      outerwear: true,
      keywords: ['tweed', 'plaid', 'wool', 'corduroy', 'turtleneck'],
      slotHints: {
        top: 'dark turtleneck sweater',
        bottom: 'brown plaid wool trousers',
        dress: 'dark tweed midi dress',
        onepiece: 'dark utilitarian jumpsuit',
        outerwear: 'long wool overcoat',
        layer: 'dark knit cardigan',
      },
    },
  },
  {
    name: 'beach linen (dress base, warm, budget)',
    budget: 400,
    attrs: {
      palette: ['white', 'cream', 'blue', 'beige'],
      avoid: ['black'],
      formality: 2,
      statementTolerance: 2,
      fit: 'relaxed',
      base: 'dress',
      layer: false,
      outerwear: false,
      keywords: ['linen', 'gauze', 'eyelet'],
      slotHints: {
        top: 'white linen shirt',
        bottom: 'flowy linen pants',
        dress: 'white linen sundress',
        onepiece: 'linen wide-leg jumpsuit',
        outerwear: 'light linen jacket',
        layer: 'light open-knit cardigan',
      },
    },
  },
  {
    name: 'loud party (statement tolerance high)',
    budget: null,
    attrs: {
      palette: ['pink', 'red', 'purple', 'silver'],
      avoid: [],
      formality: 4,
      statementTolerance: 5,
      fit: 'fitted',
      base: 'either',
      layer: false,
      outerwear: true,
      keywords: ['sequin', 'satin', 'metallic', 'velvet'],
      slotHints: {
        top: 'sequin party top',
        bottom: 'satin midi skirt',
        dress: 'sequin cocktail dress',
        onepiece: 'satin evening jumpsuit',
        outerwear: 'cropped satin jacket',
        layer: 'shimmery knit shrug',
      },
    },
  },
];

const { items } = loadCatalog();
console.log(`catalog: ${items.length} tagged items`);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

for (const fixture of FIXTURES) {
  console.log(`\nfixture: ${fixture.name}`);
  const { attrs, budget } = fixture;

  const needed = new Set();
  if (attrs.base !== 'separates') needed.add('dress').add('onepiece');
  if (attrs.base !== 'dress') needed.add('top').add('bottom');
  if (attrs.outerwear) needed.add('outerwear');
  if (attrs.layer) needed.add('layer');
  const slots = [...needed];

  const hintEmbs = await embedTexts(slots.map((s) => `a product photo of ${attrs.slotHints[s]}`));
  const pools = {};
  slots.forEach((s, i) => {
    pools[s] = candidatesForSlot(items, s, attrs, hintEmbs[i]);
  });

  const outfits = assembleOutfits({ pools, attrs, budget });

  if (outfits.length === 0) {
    fail('no outfits assembled');
    continue;
  }
  ok(`${outfits.length} outfits assembled`);

  for (const [n, o] of outfits.entries()) {
    const label = `outfit ${n + 1}`;

    // no doubled slots, no duplicate items
    if (new Set(o.slots).size !== o.slots.length) fail(`${label}: doubled slot`);
    if (new Set(o.items.map((i) => i.id)).size !== o.items.length) fail(`${label}: duplicate item`);

    // base present
    const hasBase =
      o.slots.includes('dress') || o.slots.includes('onepiece') ||
      (o.slots.includes('top') && o.slots.includes('bottom'));
    if (!hasBase) fail(`${label}: incomplete base (${o.slots.join(',')})`);

    // one statement max
    if (o.items.filter((i) => i.statement >= 4).length > 1) fail(`${label}: >1 statement piece`);

    // never all-oversized
    if (o.items.every((i) => i.fit === 'oversized')) fail(`${label}: all oversized`);

    // formality spread
    const f = o.items.map((i) => i.formality);
    if (Math.max(...f) - Math.min(...f) > 2) fail(`${label}: formality spread > 2`);

    // palette coherence (unless the relaxed pass was needed)
    if (!o.report.relaxedRules) {
      const sets = o.items.map((i) => new Set(i.palette));
      const shared = [...sets[0]].filter((fam) => sets.every((s) => s.has(fam)));
      const neutralAnchored = sets.every((s) => [...s].some((fam) => NEUTRALS.has(fam)));
      if (shared.length === 0 && !neutralAnchored) fail(`${label}: palette rule violated`);
    }

    // budget
    if (budget && o.totalRetail > budget) fail(`${label}: over budget ($${o.totalRetail} > $${budget})`);
  }
  ok('per-outfit rules hold');

  // outfits are distinct
  for (let a = 0; a < outfits.length; a++) {
    for (let b = a + 1; b < outfits.length; b++) {
      const overlap = outfits[a].items.filter((i) => outfits[b].items.some((j) => j.id === i.id));
      if (overlap.length > 2) fail(`outfits ${a + 1}/${b + 1} share ${overlap.length} items`);
    }
  }
  ok('outfits are distinct');
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall stylist rules hold');
