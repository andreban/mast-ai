import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emits `styles/default.css` into the build output as `styles.css` so the
 * `./styles.css` package export resolves to a published file inside `dist/`.
 */
function emitStylesheet(): Plugin {
  return {
    name: 'mast-ai-emit-stylesheet',
    apply: 'build',
    generateBundle() {
      const source = readFileSync(resolve(__dirname, 'styles/default.css'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'styles.css',
        source,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), emitStylesheet()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@mast-ai/core',
        '@tanstack/react-virtual',
        'react-markdown',
        'remark-gfm',
        'rehype-sanitize',
      ],
    },
  },
});
