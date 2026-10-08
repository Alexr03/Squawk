import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte(),
    {
      // transformers.js points onnxruntime at its wasm on jsDelivr at runtime, so the
      // 27 MB copy Vite emits is never fetched (and exceeds Cloudflare Pages' 25 MiB file cap).
      name: 'drop-unused-ort-wasm',
      apply: 'build',
      generateBundle(_, bundle) {
        for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name];
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: { main: 'index.html', 'audio-test': 'audio-test.html' },
    },
  },
});
