// Local CLIP text encoder (transformers.js) — embeds the vibe (and per-slot
// garment hints) into the same 512-dim space as the precomputed product image
// embeddings in data/embeddings.json. Lazy singleton: the quantized encoder
// (~17MB) loads once per server process. No inference API, no keys.
import { AutoTokenizer, CLIPTextModelWithProjection, env } from '@huggingface/transformers';
import os from 'node:os';
import path from 'node:path';

// transformers.js caches downloaded model weights under node_modules by
// default, which is read-only in a serverless deploy (Vercel). Point the cache
// at a writable temp dir so the encoder can hydrate on a cold container; on a
// dev box this just re-downloads the ~17MB weights once into /tmp.
env.cacheDir = path.join(os.tmpdir(), 'ofav-transformers-cache');

const MODEL_ID = 'Xenova/clip-vit-base-patch32';

let encoderPromise = null;

function getEncoder() {
  encoderPromise ??= (async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    const model = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'q8' });
    return { tokenizer, model };
  })();
  return encoderPromise;
}

export async function embedTexts(texts) {
  const { tokenizer, model } = await getEncoder();
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const [n, d] = text_embeds.dims;
  const data = text_embeds.data;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(normalize(Array.from(data.slice(i * d, (i + 1) * d))));
  }
  return out;
}

export function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = 1 / (Math.sqrt(s) || 1);
  return v.map((x) => x * inv);
}

// Both inputs must already be normalized.
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
