'use client';
// The application window. One state machine: idle → dialing → verdict.
// "AS IF! TRY AGAIN" re-runs the same vibe minus every item already shown.
import { useRef, useState } from 'react';
import ClosetMenu, { DEFAULT_FILTERS, activeFilterLabels } from './ClosetMenu';
import LoadingTicker from './LoadingTicker';
import OutfitBoard from './OutfitBoard';
import Stamp from './Stamp';

const EXAMPLES = [
  'dark academia but rain-proof',
  'quiet luxury on a budget',
  'coastal grandma',
  'Y2K mall rat',
  'gallery opening in the rain',
];

export default function Cherware({ samples, catalogCount, harvestedAt }) {
  const [vibe, setVibe] = useState('');
  const [budget, setBudget] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const shownIds = useRef(new Set());
  const inputRef = useRef(null);

  async function dressMe({ fresh = true } = {}) {
    const v = vibe.trim();
    if (!v || status === 'loading') return;
    if (fresh) shownIds.current = new Set();
    setStatus('loading');
    setError(null);
    try {
      const res = await fetch('/api/outfit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vibe: v,
          budget: budget ? Number(budget) : undefined,
          excludeIds: [...shownIds.current],
          filters,
        }),
      });
      // Platform-level failures (timeouts, crashed functions) return HTML, not
      // JSON — surface those as a readable verdict instead of a parse error.
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`The wardrobe computer returned static (HTTP ${res.status}). Run it back in a minute.`);
      }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (!json.outfits?.length) {
        setError(
          activeFilterLabels(filters).length
            ? 'Not even the computer can make this work with the closet filtered that hard. Loosen the Closet menu filters, soften the vibe, or raise the budget.'
            : 'Not even the computer can make this work with what’s in the closet. Soften the vibe or raise the budget.',
        );
        setStatus('error');
        return;
      }
      for (const o of json.outfits) for (const i of o.items) shownIds.current.add(i.id);
      setData(json);
      setStatus('done');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }

  function useExample(ex) {
    setVibe(ex);
    inputRef.current?.focus();
  }

  return (
    <div className="window">
      <header className="titlebar">
        <span className="titlebar-box" aria-hidden="true" />
        <h1>Outfit-o-Matic — the wardrobe computer</h1>
        <span className="titlebar-box" aria-hidden="true" />
      </header>

      <nav className="menubar">
        <span aria-hidden>File</span>
        <span aria-hidden>Edit</span>
        <span aria-hidden>Vibe</span>
        <ClosetMenu filters={filters} onChange={setFilters} />
        <span aria-hidden>Help</span>
        <span className="spacer" />
        <span className="version" aria-hidden>CHER 2.0</span>
      </nav>

      <form
        className="console"
        onSubmit={(e) => {
          e.preventDefault();
          dressMe({ fresh: true });
        }}
      >
        <div className="labelled vibe-field">
          <label htmlFor="vibe">Today’s vibe</label>
          <input
            id="vibe"
            ref={inputRef}
            className="field"
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            placeholder="dark academia but rain-proof"
            maxLength={300}
            autoComplete="off"
          />
        </div>
        <div className="labelled">
          <label htmlFor="budget">Budget (retail $)</label>
          <input
            id="budget"
            className="field budget-field"
            value={budget}
            onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="none"
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="btn btn-dressme" disabled={status === 'loading' || !vibe.trim()}>
          {status === 'loading' ? 'Computing…' : 'Dress me'}
        </button>
      </form>

      <div className="screen">
        {status === 'idle' && (
          <div className="idle">
            <p className="prompt-line">THE COMPUTER IS READY.</p>
            <p>
              Describe a vibe. The closet holds {catalogCount.toLocaleString()} rentable pieces; a
              rules engine — palette coherence, one statement piece max, balanced proportions —
              assembles the looks. No guessing.
            </p>
            <div className="chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip" onClick={() => useExample(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {status === 'loading' && <LoadingTicker samples={samples} />}

        {status === 'done' && data && (
          <>
            <Stamp floating>Match</Stamp>
            <div className="verdict-row">
              <p className="ticker" role="status">
                {data.outfits.length} LOOK{data.outfits.length > 1 ? 'S' : ''} COMPILED FOR
                “{data.vibe.toUpperCase()}”
                {activeFilterLabels(filters).map((l) => ` · ${l.toUpperCase()}`).join('')}
              </p>
              <button type="button" className="btn" onClick={() => dressMe({ fresh: false })}>
                As if! Try again
              </button>
            </div>
            {data.outfits.map((o, n) => (
              <OutfitBoard key={n} outfit={o} index={n} />
            ))}
          </>
        )}

        {status === 'error' && (
          <div className="asif">
            <Stamp>As if!</Stamp>
            <p>{error}</p>
            <button type="button" className="btn" onClick={() => dressMe({ fresh: true })}>
              Run it back
            </button>
          </div>
        )}
      </div>

      <footer className="statusbar">
        <span>{catalogCount.toLocaleString()} GARMENTS INDEXED</span>
        <span>CLOSET SNAPSHOT {harvestedAt}</span>
        <span className="right">
          {status === 'done' && data ? `VERDICT IN ${(data.tookMs / 1000).toFixed(1)}S` : 'NUULY RENTAL CLOSET'}
        </span>
      </footer>
    </div>
  );
}
