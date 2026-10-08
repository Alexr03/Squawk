import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Version (SemVer, from the root package.json), commit and build date, shown on the home screen, in Settings and the pause menu.
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;
const git = (cmd: string) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const COMMIT = (process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? git('git rev-parse HEAD')).slice(0, 7) || 'dev';
// Build number: the commit count, so every commit bumps it automatically (SemVer build metadata: 0.9.0+123).
const BUILD = git('git rev-list --count HEAD') || '0';
const DIRTY = !process.env.CF_PAGES_COMMIT_SHA && !process.env.GITHUB_SHA && git('git status --porcelain') !== '';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __APP_COMMIT__: JSON.stringify(COMMIT + (DIRTY ? '+' : '')),
    __APP_BUILD__: JSON.stringify(BUILD),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
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
