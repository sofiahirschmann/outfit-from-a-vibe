// The rubber stamp — the one loud thing on the page. MATCH slams onto
// results; MISMATCH / AS IF! handles errors and empty verdicts.
export default function Stamp({ children, floating = false }) {
  return (
    <div className={`stamp${floating ? ' floating' : ''}`} aria-hidden="true">
      {children}
    </div>
  );
}
