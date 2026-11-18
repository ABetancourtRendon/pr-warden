import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  dts: {
    entry: ['src/index.ts'],
  },
  target: 'node20',
  clean: true,
  sourcemap: false,
});
