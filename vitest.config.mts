import { defineConfig } from "vitest/config";

/**
 * Node-environment unit tests for the session-independent logic (config
 * resolution, protocol handshake, inspector adapter, payload contract,
 * transport). Nothing here renders the RN tree. Transport security tests use loopback
 * HTTP servers; other tests stub network access.
 * RN/DevTools surfaces are stubbed in test/helpers/stubs.ts.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
  },
});
