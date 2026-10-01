/* global module */
class NodeUsbTransport {
  constructor(params) {
    this.id = params.id
    this.api = {
      resetDevice: jest.fn(async () => undefined),
      devices: [],
      closeDevice: jest.fn(async () => ({ success: true }))
    }
  }

  stop() {}
}

module.exports = { NodeUsbTransport }
