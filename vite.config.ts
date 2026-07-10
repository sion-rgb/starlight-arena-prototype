import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'github-pages' ? '/starlight-arena-prototype/' : '/',
  server: {
    host: '0.0.0.0',
  },
}));
