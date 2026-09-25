import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

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
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    root: 'src/renderer'
  }
})
