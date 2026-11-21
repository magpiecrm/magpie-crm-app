/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
  server: {
    host: true,
    allowedHosts: true,
    cors: true
  },
  preview: {
    host: true,
    allowedHosts: true,
    cors: true
  },
  test: {
    // Agents' worktrees live under .claude/worktrees, each a whole checkout of
    // some other branch: their tests aren't this checkout's.
    exclude: ['**/node_modules/**', '**/.git/**', '.claude/**', 'scratch/**', 'test/e2e/**'],
    setupFiles: ['./test/setup/isolateEnv.ts'],
  },
})


export default config
