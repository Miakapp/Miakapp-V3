import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
