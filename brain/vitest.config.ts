import { defineConfig } from 'vitest/config';

// A cold transform on a slow disk can take longer than vitest's 5 s default for
// the tests that import the whole brain.
export default defineConfig({ test: { testTimeout: 20_000 } });
