import { configDefaults, defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Two projects sharing this root config (alias, defaults): the pure game core, data, server and
 * scripts run under node; anything under src/components runs under jsdom. (Vitest 5 removed
 */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: [...configDefaults.exclude, 'src/components/**'],
          // The pacing suite replays a seven-day simulation per case. That is a second or two on a
          // laptop and four times that on a shared CI runner, so the 5 s default flakes there.
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/components/**/*.test.ts', 'src/components/**/*.test.tsx'],
        },
      },
    ],
  },
})
