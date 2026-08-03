// Setup for the "components" Vitest project only (see vitest.config.ts's
// `projects[1].test.setupFiles`) — extends `expect` with jest-dom's DOM
// matchers (toBeDisabled, etc.) for happy-dom component tests. Never loaded
// by the "security" project, so it has zero effect on that suite.
import "@testing-library/jest-dom/vitest";
