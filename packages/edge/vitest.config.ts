import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The integration tests share one local database, and refresh-listings works
    // through every listing that's due, so the files run one after another.
    fileParallelism: false,
  },
})
