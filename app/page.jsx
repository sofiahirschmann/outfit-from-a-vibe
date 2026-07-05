// Server component: hands the client window a deterministic sample of closet
// images (for the loading riffle) plus catalog stats for the status bar.
import fs from 'node:fs';
import path from 'node:path';
import Cherware from './components/Cherware';

export const dynamic = 'force-dynamic';

function loadCatalogMeta() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data', 'catalog.json'), 'utf8'),
    );
    // Deterministic spread across the catalog so the riffle shows variety.
    const step = Math.max(1, Math.floor(raw.items.length / 24));
    const samples = raw.items.filter((_, n) => n % step === 0).slice(0, 24).map((i) => i.image);
    return { samples, count: raw.count, harvestedAt: raw.harvestedAt };
  } catch {
    return { samples: [], count: 0, harvestedAt: '—' };
  }
}

export default function Home() {
  const { samples, count, harvestedAt } = loadCatalogMeta();
  return (
    <main style={{ display: 'contents' }}>
      <Cherware samples={samples} catalogCount={count} harvestedAt={harvestedAt} />
    </main>
  );
}
