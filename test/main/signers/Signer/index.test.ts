import Signer from '../../../../main/signers/Signer'

describe('Signer unsupported operations', () => {
  it('settles an unsupported message request with an error', () => {
    const signer = new Signer()
    const callback = jest.fn()

    signer.signMessage(0, '0x', callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(callback.mock.calls[0][1]).toBeUndefined()
  })

  it('settles an unsupported transaction request with an error', () => {
    const signer = new Signer()
    const callback = jest.fn()

    signer.signTransaction(0, { chainId: '0x1' }, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error)
    expect(callback.mock.calls[0][1]).toBeUndefined()
  })
})
