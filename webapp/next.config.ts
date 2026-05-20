import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence "multiple lockfiles" warning — pin tracing to the webapp directory.
  outputFileTracingRoot: process.cwd(),
  // bb.js & noir_js ship CommonJS, WASM, and Node `worker_threads` code paths.
  // Letting the bundler trace them on the server side fork-bombs the dev server
  // (300+ child processes registering loader hooks). Mark them external on the
  // server so they're never bundled there; they're only used in the browser via
  // the dynamic import in `lib/hashPreimage.ts`.
  serverExternalPackages: ["@aztec/bb.js", "@noir-lang/noir_js"],
  // @aztec/bb.js uses SharedArrayBuffer (Web Workers + atomics) which requires
  // cross-origin isolation. Without these headers the WASM backend silently
  // falls back to slow paths or fails to instantiate.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
