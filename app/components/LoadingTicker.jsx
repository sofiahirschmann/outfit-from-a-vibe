'use client';
// The dial-up moment: three polaroids riffle through the actual harvested
// closet while the ticker narrates what the stylist engine is really doing.
import { useEffect, useState } from 'react';

const LINES = [
  'DIALING THE WARDROBE…',
  'CONSULTING CHER…',
  'CROSS-REFERENCING YOUR CLOSET…',
  'COMPUTING COLOR COHERENCE…',
  'BALANCING PROPORTIONS…',
  'ONE STATEMENT PIECE, MAX…',
  'REJECTING MISMATCHES…',
  'WRITING THE VERDICT…',
];

export default function LoadingTicker({ samples }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 240);
    return () => clearInterval(id);
  }, []);

  const line = LINES[Math.floor(tick / 8) % LINES.length];
  const frames = [0, 1, 2];

  return (
    <div className="loading riffle" role="status" aria-live="polite">
      <div className="riffle-row">
        {frames.map((f) => {
          const src = samples.length
            ? samples[(tick + f * 7) % samples.length]
            : null;
          return (
            <figure key={f} className="polaroid flip" style={{ '--tilt': `${(f - 1) * 5}deg` }}>
              {src ? (
                <img src={`${src}?wid=360&fit=constrain`} alt="" aria-hidden="true" />
              ) : (
                <div style={{ aspectRatio: '3 / 4', background: '#edece7' }} />
              )}
              <figcaption>
                <span className="brand">SCANNING…</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="ticker">
        {line} <span className="cursor">▮</span>
      </p>
    </div>
  );
}
