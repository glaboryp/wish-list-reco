// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: vercel({ maxDuration: 60 }),
  devToolbar: { enabled: process.env.MOCK_DB !== 'true' },
});
