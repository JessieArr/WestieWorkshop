import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'

/** GitHub Pages has no SPA fallback; 404.html is served for unknown paths. */
function githubPagesSpa(): Plugin {
  return {
    name: 'github-pages-spa',
    closeBundle() {
      const docs = resolve(import.meta.dirname, 'docs')
      copyFileSync(resolve(docs, 'index.html'), resolve(docs, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), githubPagesSpa()],
  base: '/WestieWorkshop/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
})
