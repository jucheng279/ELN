import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          tiptap: [
            '@tiptap/react',
            '@tiptap/starter-kit',
            '@tiptap/extension-placeholder',
            '@tiptap/extension-underline',
            '@tiptap/extension-link',
            '@tiptap/extension-subscript',
            '@tiptap/extension-superscript',
            '@tiptap/extension-highlight',
            '@tiptap/extension-task-list',
            '@tiptap/extension-task-item',
          ],
          pdf: ['jspdf', 'jspdf-autotable'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
