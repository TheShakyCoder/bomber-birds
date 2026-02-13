import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false, // Combine CSS to save memory during splitting phase
    minify: 'esbuild',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      maxParallelFileOps: 1,
      cache: false,
      output: {
        manualChunks: {
          'babylon-chunk': ['@babylonjs/core', '@babylonjs/materials'],
          'colyseus-chunk': ['@colyseus/sdk'],
        },
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  }
})
