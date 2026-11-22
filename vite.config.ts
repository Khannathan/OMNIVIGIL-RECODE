import { defineConfig } from 'vitest/config';

// Static build for itch.io: relative paths, no server needed.
// Everything in assets/ (art/, audio/) is copied as-is, so the final files
// can be dropped into assets/art/ under their exact names and just work.
export default defineConfig({
  base: './',
  publicDir: 'assets',
  build: {
    outDir: 'dist',
    assetsDir: 'bundle',
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
