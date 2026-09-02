import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    alwaysBundle: (id) => (
      id !== 'electron'
      && !id.startsWith('node:')
    ),
    neverBundle: ['electron'],
    onlyBundle: false,
  },
})
