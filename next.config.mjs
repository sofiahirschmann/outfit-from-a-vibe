/** @type {import('next').NextConfig} */
const nextConfig = {
  // transformers.js + onnxruntime ship native binaries; keep them external to
  // the server bundle so the CLIP text encoder can run in the Node runtime.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
};

export default nextConfig;
