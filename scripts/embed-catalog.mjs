#!/usr/bin/env node
// CLIP image embeddings for every catalog item → data/embeddings.json.
//
//   node scripts/embed-catalog.mjs [--force] [--from-raw]
//
// Embeddings are keyed by product ID and cached: items already present in
// embeddings.json are never re-embedded (they don't change). Images come from
// Nuuly's Scene7 CDN with a width param so we don't pull full-size shots.
// --from-raw reads data/catalog-raw.jsonl instead of catalog.json, so
// embedding can run in parallel with the harvest's LLM tagging pass.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from '@huggingface/transformers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = path.join(ROOT, 'data', 'catalog.json');
const OUT_PATH = path.join(ROOT, 'data', 'embeddings.json');
const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const FORCE = process.argv.includes('--force');
const FROM_RAW = process.argv.includes('--from-raw');
const CONCURRENCY = 4;

const catalog = FROM_RAW
  ? {
      items: fs
        .readFileSync(path.join(ROOT, 'data', 'catalog-raw.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    }
  : JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const existing =
  !FORCE && fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')).vectors
    : {};

const todo = catalog.items.filter((i) => !existing[i.id]);
console.log(`${catalog.items.length} items, ${todo.length} to embed (${Object.keys(existing).length} cached)`);

const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });

const vectors = { ...existing };
let done = 0, failed = 0;

async function embedItem(item) {
  // Scene7 params: constrain to 336px wide — plenty for a 224px CLIP crop.
  const url = `${item.image}?wid=336&fit=constrain`;
  const image = await RawImage.fromURL(url);
  const inputs = await processor(image);
  const { image_embeds } = await vision(inputs);
  const v = Array.from(image_embeds.data);
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  vectors[item.id] = v.map((x) => Number((x / norm).toFixed(6)));
}

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async (item) => {
      try {
        await embedItem(item);
        done++;
      } catch (err) {
        failed++;
        console.warn(`  ! ${item.id} (${item.slug}): ${err.message}`);
      }
    }),
  );
  if ((i / CONCURRENCY) % 10 === 0 || i + CONCURRENCY >= todo.length) {
    console.log(`  ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length} (${failed} failed)`);
    // checkpoint so an interrupted run resumes where it left off
    fs.writeFileSync(OUT_PATH, JSON.stringify({ model: MODEL_ID, dim: 512, vectors }));
  }
}

fs.writeFileSync(OUT_PATH, JSON.stringify({ model: MODEL_ID, dim: 512, vectors }));
console.log(`wrote ${OUT_PATH}: ${Object.keys(vectors).length} vectors (${done} new, ${failed} failed)`);
