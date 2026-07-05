// Post-assembly explanation. The LLM writes the "why these work together"
// notes AFTER the stylist has chosen the pieces — it explains decisions, it
// never makes them. One call covers all outfits in the response.
import { llmJSON } from './llm.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['looks'],
  properties: {
    looks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'note'],
        properties: {
          name: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM = `You write the result cards for a Clueless-inspired outfit-matching program (think Cher Horowitz's wardrobe computer, 1995). For each assembled look you receive, write:
- name: a short, fun, era-flavored look name (2-4 words, no quotes, e.g. "Rainy Day Valedictorian")
- note: 1-2 sentences on why THESE specific pieces work together — reference the actual garments, their colors, textures, and proportions, and how they serve the requested vibe. Sound like a confident stylist, lightly 90s, never cheesy enough to hurt.

The pieces were chosen by a rules engine (palette coherence, one statement piece max, fit balance, formality match). Explain the choices; do not suggest different pieces. Return exactly one entry per look, in order.`;

export async function explainOutfits(vibe, outfits) {
  if (outfits.length === 0) return outfits;
  const prompt =
    `Vibe requested: ${JSON.stringify(vibe)}\n\nLooks:\n` +
    outfits
      .map(
        (o, n) =>
          `${n + 1}. ` +
          o.items
            .map((i) => `${i.title} by ${i.brand ?? 'unknown'} (${i.slot}, ${i.color?.name?.toLowerCase() ?? ''} ${i.fit})`)
            .join(' + ') +
          ` — shared palette: ${o.report.sharedFamilies.join('/') || 'neutrals'}; statement: ${o.report.statementPiece ?? 'none'}`,
      )
      .join('\n');

  try {
    const res = await llmJSON({ system: SYSTEM, prompt, schema: SCHEMA, maxTokens: 1500 });
    outfits.forEach((o, n) => {
      o.name = res.looks[n]?.name ?? `Look ${n + 1}`;
      o.note = res.looks[n]?.note ?? fallbackNote(o);
    });
  } catch {
    // The looks are already assembled — a missing caption should never sink
    // the response. Fall back to a deterministic note from the rule report.
    outfits.forEach((o, n) => {
      o.name = `Look ${n + 1}`;
      o.note = fallbackNote(o);
    });
  }
  return outfits;
}

function fallbackNote(o) {
  const fams = o.report.sharedFamilies.join(' and ');
  const parts = [
    fams ? `Everything here shares ${fams}` : 'Every piece anchors to a neutral',
    o.report.statementPiece ? `the ${o.report.statementPiece} does the talking` : 'no piece shouts over the others',
  ];
  return parts.join('; ') + '.';
}
