import HotSignerAdapter from '../../../../main/signers/hot/adapter'
import hot from '../../../../main/signers/hot'

const mockScanner = () => ({ close: jest.fn(), scan: jest.fn(() => Promise.resolve()) })

jest.mock('../../../../main/signers/hot', () => ({
  createScanner: jest.fn()
}))

describe('HotSignerAdapter', () => {
  beforeEach(() => {
    hot.createScanner.mockReset()
  })

  it('owns scanner startup, reload, and shutdown', () => {
    const firstScanner = mockScanner()
    const secondScanner = mockScanner()
    hot.createScanner.mockReturnValueOnce(firstScanner).mockReturnValueOnce(secondScanner)
    const adapter = new HotSignerAdapter(() => false)
    const add = jest.fn()
    adapter.on('add', add)

    adapter.open()
    adapter.open()
    expect(hot.createScanner).toHaveBeenCalledTimes(1)

    const scannerTarget = hot.createScanner.mock.calls[0][0]
    const signer = { close: jest.fn(), delete: jest.fn() }
    scannerTarget.add(signer)
    adapter.reload(signer)

    expect(add).toHaveBeenCalledWith(signer)
    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(firstScanner.scan).toHaveBeenCalledTimes(1)

    adapter.close()
    expect(firstScanner.close).toHaveBeenCalledTimes(1)

    adapter.open()
    expect(hot.createScanner).toHaveBeenCalledTimes(2)
    adapter.close()
  })

  it('closes and deletes a signer only when it is removed', () => {
    hot.createScanner.mockReturnValue(mockScanner())
    const adapter = new HotSignerAdapter(() => false)
    const signer = { close: jest.fn(), delete: jest.fn() }

    adapter.remove(signer)

    expect(signer.close).toHaveBeenCalledTimes(1)
    expect(signer.delete).toHaveBeenCalledTimes(1)
  })
})
