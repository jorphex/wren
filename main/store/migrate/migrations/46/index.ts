// Version 46 was retained after gas-fee compatibility moved into the persisted-state schema.
// Existing profiles may already carry this version, so it cannot be removed or reused.
const migrate = (initial: unknown) => initial

export default {
  version: 46,
  migrate
}
