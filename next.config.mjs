/** @type {import('next').NextConfig} */
const nextConfig = {
  // transformers.js + onnxruntime ship native binaries; keep them external to
  // the server bundle so the CLIP text encoder can run in the Node runtime.
  serverExternalPackages: ['@huggingface/transformers', 'onnxruntime-node'],
  // Vercel's file tracer picks up onnxruntime's .node addon but not the
  // libonnxruntime.so it dlopens next to it, so the function 500s at import
  // ("libonnxruntime.so.1: cannot open shared object file"). Force the linux
  // binaries (~52MB, well under the function size limit) into the trace.
  outputFileTracingIncludes: {
    '/api/outfit': ['./node_modules/onnxruntime-node/bin/napi-v6/linux/**/*'],
  },
};

export default nextConfig;
