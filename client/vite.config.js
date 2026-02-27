import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from project root (parent directory of client/)
  const env = loadEnv(mode, path.resolve(process.cwd(), '..'), 'VITE_');

  return {
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
    },
    server: {
      cors: {
        origin: [
          `${env.VITE_SERVER_URL}`
        ]
      },
      // respond to all network requests:
      host: "0.0.0.0",
      port: parseInt(env.VITE_CLIENT_PORT) || 5173,
      strictPort: true,
      // Defines the origin of the generated asset URLs during development
      origin: `${env.VITE_DOMAIN}:${env.VITE_CLIENT_PORT}`,
    },
  }
})
