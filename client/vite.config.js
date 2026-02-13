import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    minify: 'esbuild',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      maxParallelFileOps: 1,
      cache: false,
      output: {
        manualChunks: undefined
      }
    }
  }
})
