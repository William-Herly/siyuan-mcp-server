// --workspace does not isolate SiYuan's shared per-user startup configuration.
export function requireVerifiedIntegrationIsolation() {
  throw new Error("Real SiYuan integration tests are temporarily disabled: CLI startup modifies the shared user workspace registry even with --workspace. Implement and verify OS-user/VM isolation before re-enabling these scripts. Unit tests remain available via npm test.");
}
