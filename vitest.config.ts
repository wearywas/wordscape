import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Private release-check copies are archives, not extra test coverage.
  test: { include: ['{src,server,scripts}/**/*.test.{ts,tsx,mjs}'] },
});
