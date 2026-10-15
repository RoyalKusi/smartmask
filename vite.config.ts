import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'], testTimeout: 30000 },
});
