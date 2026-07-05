// Final end-to-end verification against the running dev server.
// Usage: node final-verify.mjs [baseUrl]
const BASE = process.argv[2] ?? 'http://localhost:3456';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.error(`  ✗ ${m}`); };

async function ask(body) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/outfit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json, secs: ((Date.now() - t0) / 1000).toFixed(1) };
}

function checkRules(outfits, { budget = null } = {}) {
  for (const [n, o] of outfits.entries()) {
    const L = `look ${n + 1}`;
    if (new Set(o.items.map((i) => i.slot)).size !== o.items.length) fail(`${L}: doubled slot`);
    if (o.items.filter((i) => i.statement >= 4).length > 1) fail(`${L}: >1 statement piece`);
    if (o.items.every((i) => i.fit === 'oversized')) fail(`${L}: all oversized`);
    if (budget && o.totalRetail > budget) fail(`${L}: over budget $${o.totalRetail} > $${budget}`);
    if (!o.items.every((i) => i.url?.startsWith('https://www.nuuly.com/rent/products/'))) fail(`${L}: bad product URL`);
    if (!o.name || !o.note) fail(`${L}: missing name/note`);
  }
}

// 1. cold vibes
for (const vibe of ['coastal grandma', 'Y2K mall rat']) {
  console.log(`\nvibe: "${vibe}"`);
  const { status, json, secs } = await ask({ vibe });
  if (status !== 200) { fail(`HTTP ${status}: ${json.error}`); continue; }
  if (!json.outfits?.length) { fail('no outfits'); continue; }
  ok(`${json.outfits.length} outfits in ${secs}s (catalog ${json.catalog.count})`);
  checkRules(json.outfits);
  ok(`names: ${json.outfits.map((o) => o.name).join(' · ')}`);
}

// 2. budget cap
console.log('\nvibe: "quiet luxury on a budget" with budget=400');
{
  const { status, json } = await ask({ vibe: 'quiet luxury on a budget', budget: 400 });
  if (status !== 200 || !json.outfits?.length) fail(`budget run failed (${status})`);
  else {
    checkRules(json.outfits, { budget: 400 });
    ok(`totals: ${json.outfits.map((o) => '$' + o.totalRetail).join(' ')} (all ≤ $400)`);
  }
}

// 3. gibberish vibe should still produce a best-guess result, not a 500
console.log('\nvibe: gibberish');
{
  const { status, json } = await ask({ vibe: 'zxqv blorptastic 9000!!' });
  if (status !== 200) fail(`gibberish returned HTTP ${status}`);
  else ok(`gibberish handled: ${json.outfits?.length ?? 0} outfits`);
}

// 4. try-again exclusion produces disjoint looks
console.log('\ntry-again disjointness');
{
  const first = await ask({ vibe: 'dark academia but rain-proof' });
  const shown = first.json.outfits?.flatMap((o) => o.items.map((i) => i.id)) ?? [];
  const second = await ask({ vibe: 'dark academia but rain-proof', excludeIds: shown });
  const reshown = second.json.outfits?.flatMap((o) => o.items.map((i) => i.id)).filter((id) => shown.includes(id)) ?? [];
  if (second.status !== 200 || !second.json.outfits?.length) fail('try-again run failed');
  else if (reshown.length) fail(`try-again reshowed ${reshown.length} excluded items`);
  else ok(`second round fully disjoint (${shown.length} ids excluded)`);
  checkRules(second.json.outfits ?? []);
}

// 5. closet filters (menubar) are hard constraints on every returned item
console.log('\nfilters: cold weather + casual');
{
  const { status, json } = await ask({
    vibe: 'dark academia but rain-proof',
    filters: { weather: 'cold', occasion: 'casual' },
  });
  if (status !== 200 || !json.outfits?.length) fail(`filtered run failed (${status})`);
  else {
    let bad = 0;
    for (const o of json.outfits) {
      for (const i of o.items) {
        if (!(i.weather.includes('Cold Weather') || i.weather.includes('Year-Round'))) {
          bad++; fail(`${i.id} (${i.title}): weather ${JSON.stringify(i.weather)} escapes cold filter`);
        }
        if (!i.occasions.some((x) => x.toLowerCase() === 'casual')) {
          bad++; fail(`${i.id} (${i.title}): occasions ${JSON.stringify(i.occasions)} escapes casual filter`);
        }
      }
    }
    if (!bad) ok(`all ${json.outfits.reduce((n, o) => n + o.items.length, 0)} items respect both filters (pool ${json.catalog.pool}/${json.catalog.count})`);
    checkRules(json.outfits);
  }
}

// 6. spot-check that product links resolve on nuuly.com
console.log('\nlive link spot-check');
{
  const { json } = await ask({ vibe: 'coastal grandma' });
  const urls = (json.outfits ?? []).slice(0, 1).flatMap((o) => o.items.map((i) => i.url)).slice(0, 3);
  for (const url of urls) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    }).catch(() => null);
    // DataDome may 403 the datacenter-ish fingerprint — treat 200/403 as "exists", 404 as stale
    if (!res) fail(`${url}: network error`);
    else if (res.status === 404) fail(`${url}: 404 (stale)`);
    else ok(`${url.split('/products/')[1]} → HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
