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
