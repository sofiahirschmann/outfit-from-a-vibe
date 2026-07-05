// The fixed color-family vocabulary shared by the harvest tagger, the vibe
// expander, and the stylist's palette-coherence rule. One source of truth:
// scripts/ and lib/ both import from here.

export const PALETTE = [
  'black', 'white', 'cream', 'beige', 'brown', 'gray', 'navy', 'blue', 'denim',
  'green', 'olive', 'red', 'burgundy', 'pink', 'purple', 'yellow', 'orange',
  'gold', 'silver', 'multi',
];

// Families that "go with anything" — the palette rule accepts an outfit when
// every piece shares a family OR every piece contains at least one neutral.
export const NEUTRALS = new Set([
  'black', 'white', 'cream', 'beige', 'brown', 'gray', 'navy', 'denim',
]);

// Deterministic hex → palette family (for solid colorways; prints get their
// families from the LLM tagging pass, unioned with this).
export function hexToFamily(hex) {
  if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return null;
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 510; // lightness 0..1
  const d = max - min;
  const s = d === 0 ? 0 : d / (255 - Math.abs(max + min - 255)); // saturation 0..1
  if (d < 24 || s < 0.09) {
    if (l < 0.13) return 'black';
    if (l > 0.92) return 'white';
    if (l > 0.75) return 'cream';
    return 'gray';
  }
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l < 0.28 ? 'burgundy' : 'red';
  if (h < 40) return l < 0.35 ? 'brown' : l > 0.72 ? 'beige' : 'orange';
  if (h < 70) return l < 0.32 || s < 0.45 ? 'olive' : 'yellow';
  if (h < 165) return 'green';
  if (h < 255) return l < 0.3 ? 'navy' : 'blue';
  if (h < 290) return 'purple';
  return l > 0.6 ? 'pink' : 'burgundy';
}
