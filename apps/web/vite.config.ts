import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
    {
      // PWA: emit sw.js with the app shell to precache: JS, CSS and fonts, not the data packs (cached on first use),
      // the test pages, or the Whisper/transformers chunk (voice input fetches it, and its models, on demand).
      name: 'service-worker',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        const shell = Object.keys(bundle).filter(f => /\.(js|css|woff2)$/.test(f) && !/transformers|ort-|render-test|audio-test/.test(f));
        const list = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', ...shell.sort()];
        const version = createHash('sha256').update(list.join()).digest('hex').slice(0, 10);
        const src = readFileSync(new URL('./sw.js', import.meta.url), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: { main: 'index.html', 'audio-test': 'audio-test.html', 'render-test': 'render-test.html' },
    },
  },
});
