const { TestEnvironment } = require('jest-environment-node')

module.exports = class IsolatedEnvironment extends TestEnvironment {
  async teardown() {
    this.global.__WREN_E2E_ISOLATION__?.restore()
    await super.teardown()
  }
}
