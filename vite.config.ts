import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the site from /<repo>/; override with BASE=/ for a custom domain.
const base = (globalThis as any).process?.env?.BASE ?? '/hymnal/'

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['fonts/*.woff2', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '새찬송가 Hymnal',
        short_name: '찬송가',
        description: 'Band hymnal: search by number, transpose to any key, Korean and English lyrics.',
        lang: 'ko',
        display: 'standalone',
        background_color: '#faf8f4',
        theme_color: '#faf8f4',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: null,
        runtimeCaching: [
          {
            // hymn files are content-hashed, so a cached copy is always correct
            urlPattern: ({ url }) => url.pathname.includes('/hymns/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'hymns',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
})
