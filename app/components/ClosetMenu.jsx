'use client';
// The one working menu in the menubar: closet filters. Weather and occasion
// are real harvested facets (every item carries facets.weather), applied as
// hard constraints server-side before the stylist ever sees a candidate.
// Size is deliberately a disabled row: the snapshot has no per-size stock and
// Nuuly's size availability is live — pretending to filter would be dishonest.
import { useEffect, useRef, useState } from 'react';

export const DEFAULT_FILTERS = { weather: 'any', occasion: 'any' };

export const WEATHER_OPTIONS = [
  { value: 'any', label: 'Any weather' },
  { value: 'warm', label: 'Warm weather' },
  { value: 'cold', label: 'Cold weather' },
];

export const OCCASION_OPTIONS = [
  { value: 'any', label: 'Any occasion' },
  { value: 'casual', label: 'Casual' },
  { value: 'going out', label: 'Going out' },
  { value: 'work', label: 'Work' },
  { value: 'cocktail', label: 'Cocktail' },
  { value: 'formal', label: 'Formal' },
  { value: 'lounge', label: 'Lounge' },
];

export function activeFilterLabels(filters) {
  const labels = [];
  if (filters.weather !== 'any') {
    labels.push(WEATHER_OPTIONS.find((o) => o.value === filters.weather)?.label);
  }
  if (filters.occasion !== 'any') {
    labels.push(OCCASION_OPTIONS.find((o) => o.value === filters.occasion)?.label);
  }
  return labels.filter(Boolean);
}

export default function ClosetMenu({ filters, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCount = activeFilterLabels(filters).length;

  const pick = (key, value) => onChange({ ...filters, [key]: value });

  return (
    <span className="menu" ref={rootRef}>
      <button
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        Closet{activeCount > 0 && <span className="filter-dot"> ●{activeCount}</span>}
      </button>

      {open && (
        <div className="menu-panel" role="menu" aria-label="Closet filters">
          <div className="menu-head">Weather</div>
          {WEATHER_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={filters.weather === o.value}
              className="menu-item"
              onClick={() => pick('weather', o.value)}
            >
              <span className="check">{filters.weather === o.value ? '✓' : ''}</span>
              {o.label}
            </button>
          ))}

          <div className="menu-sep" />
          <div className="menu-head">Occasion</div>
          {OCCASION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={filters.occasion === o.value}
              className="menu-item"
              onClick={() => pick('occasion', o.value)}
            >
              <span className="check">{filters.occasion === o.value ? '✓' : ''}</span>
              {o.label}
            </button>
          ))}

          <div className="menu-sep" />
          <button type="button" className="menu-item" disabled title="The closet snapshot has no per-size stock; sizes are live on each Nuuly listing.">
            <span className="check" />
            Size — see the Nuuly listing
          </button>
        </div>
      )}
    </span>
  );
}
