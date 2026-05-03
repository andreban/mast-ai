import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Emits the default stylesheet and theme presets into the build output so
 * each `./styles.css` / `./themes/*.css` package export resolves to a
 * published file inside `dist/`.
 */
function emitStylesheets(): Plugin {
  const assets: { source: string; fileName: string }[] = [
    { source: 'styles/default.css', fileName: 'styles.css' },
    { source: 'themes/tailwind-shadcn.css', fileName: 'themes/tailwind-shadcn.css' },
  ];
  return {
    name: 'mast-ai-emit-stylesheets',
    apply: 'build',
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: 'asset',
          fileName: asset.fileName,
          source: readFileSync(resolve(__dirname, asset.source), 'utf8'),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), emitStylesheets()],
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
