// One assembled look: the polaroid row plus the stylist's receipt — name,
// note, retail-value math, and the palette families the rules agreed on.
import PolaroidCard from './PolaroidCard';
import { PALETTE_COLORS } from './palette-colors';

const TILTS = [-2.5, 1.8, -1.2, 2.4, -1.8];

export default function OutfitBoard({ outfit, index }) {
  const families = outfit.report?.sharedFamilies?.length
    ? outfit.report.sharedFamilies
    : [...new Set(outfit.items.flatMap((i) => i.palette ?? []))].slice(0, 5);

  return (
    <section className="look" aria-label={`Look ${index + 1}: ${outfit.name}`}>
      <div className="cards">
        {outfit.items.map((item, n) => (
          <PolaroidCard key={item.id} item={item} tilt={TILTS[(index + n) % TILTS.length]} />
        ))}
      </div>
      <aside>
        <h3 className="look-name">
          №{index + 1} {outfit.name}
        </h3>
        <p className="look-note">{outfit.note}</p>
        <div className="palette-chips" aria-hidden="true">
          {families.map((f) => (
            <i key={f} title={f} style={{ background: PALETTE_COLORS[f] ?? '#ccc' }} />
          ))}
        </div>
        <div className="money">
          <div className="total">RETAIL VALUE: ${outfit.totalRetail}</div>
          <div>ON NUULY: ONE SLOT PER PIECE</div>
          <div className="punchline">6 SLOTS = $98/MO. DO THE MATH.</div>
        </div>
      </aside>
    </section>
  );
}
