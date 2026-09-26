import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'

// Dev-only: strip the strict production CSP meta tag when serving. Vite dev
// injects styles and the react-refresh preamble as inline <style>/<script>,
// which the production policy (correctly) forbids. The main process sets a
// relaxed dev CSP header instead; production keeps the meta untouched.
const devCspRelax: Plugin = {
  name: 'rased-dev-csp',
  apply: 'serve',
  transformIndexHtml(html: string): string {
    return html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '<!-- dev: CSP is set per-environment by the main process -->')
  }
}

export default defineConfig({
  main: {
    build: { lib: { entry: 'src/main/index.ts' } },
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    build: { lib: { entry: 'src/preload/index.ts' } },
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    build: { rollupOptions: { input: 'src/renderer/index.html' } },
    plugins: [react(), devCspRelax],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    root: 'src/renderer'
  }
})
