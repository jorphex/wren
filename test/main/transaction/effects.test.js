import { parseSimulationEffects } from '../../../main/transaction/effects'

const topics = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  approvalForAll: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
  transferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  transferBatch: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
  deposit: '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c',
  withdrawal: '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'
}
const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const owner = '0x1111111111111111111111111111111111111111'
const recipient = '0x2222222222222222222222222222222222222222'
const operator = '0x3333333333333333333333333333333333333333'
const word = (value) => BigInt(value).toString(16).padStart(64, '0')
const topicAddress = (address) => `0x${'0'.repeat(24)}${address.slice(2)}`
const log = (eventTopics, words = []) => ({
  address: token,
  topics: eventTopics,
  data: `0x${words.join('')}`
})

it('decodes canonical ERC-20 and ERC-721 transfer and approval events', () => {
  expect(
    parseSimulationEffects([
      log([topics.transfer, topicAddress(owner), topicAddress(recipient)], [word(10)]),
      log([topics.approval, topicAddress(owner), topicAddress(operator)], [word(20)]),
      log([topics.transfer, topicAddress(owner), topicAddress(recipient), `0x${word(42)}`]),
      log([topics.approval, topicAddress(owner), topicAddress(operator), `0x${word(43)}`])
    ])
  ).toEqual({
    truncated: false,
    effects: [
      { type: 'transfer', standard: 'erc20', token, from: owner, to: recipient, amount: '10' },
      { type: 'approval', standard: 'erc20', token, owner, spender: operator, amount: '20' },
      { type: 'transfer', standard: 'erc721', token, from: owner, to: recipient, tokenId: '42' },
      { type: 'approval', standard: 'erc721', token, owner, spender: operator, tokenId: '43' }
    ]
  })
})

it('decodes canonical operator and ERC-1155 transfer events', () => {
  expect(
    parseSimulationEffects([
      log([topics.approvalForAll, topicAddress(owner), topicAddress(operator)], [word(1)]),
      log(
        [topics.transferSingle, topicAddress(operator), topicAddress(owner), topicAddress(recipient)],
        [word(7), word(8)]
      ),
      log(
        [topics.transferBatch, topicAddress(operator), topicAddress(owner), topicAddress(recipient)],
        [word(64), word(160), word(2), word(9), word(10), word(2), word(11), word(12)]
      )
    ])
  ).toEqual({
    truncated: false,
    effects: [
      {
        type: 'operator-approval',
        standard: 'erc721-or-erc1155',
        token,
        owner,
        operator,
        approved: true
      },
      {
        type: 'transfer',
        standard: 'erc1155',
        token,
        from: owner,
        to: recipient,
        tokenId: '7',
        amount: '8'
      },
      {
        type: 'transfer',
        standard: 'erc1155',
        token,
        from: owner,
        to: recipient,
        tokenId: '9',
        amount: '11'
      },
      {
        type: 'transfer',
        standard: 'erc1155',
        token,
        from: owner,
        to: recipient,
        tokenId: '10',
        amount: '12'
      }
    ]
  })
})

it('projects canonical wrapped-native deposits and withdrawals as token balance changes', () => {
  expect(
    parseSimulationEffects([
      log([topics.deposit, topicAddress(owner)], [word(10)]),
      log([topics.withdrawal, topicAddress(owner)], [word(7)])
    ])
  ).toEqual({
    truncated: false,
    effects: [
      {
        type: 'transfer',
        standard: 'erc20',
        token,
        from: '0x0000000000000000000000000000000000000000',
        to: owner,
        amount: '10'
      },
      {
        type: 'transfer',
        standard: 'erc20',
        token,
        from: owner,
        to: '0x0000000000000000000000000000000000000000',
        amount: '7'
      }
    ]
  })
})

it('ignores malformed event lookalikes', () => {
  expect(
    parseSimulationEffects([
      log([topics.transfer, `0x${'1'.repeat(64)}`, topicAddress(recipient)], [word(10)]),
      log([topics.approvalForAll, topicAddress(owner), topicAddress(operator)], [word(2)]),
      log(
        [topics.transferBatch, topicAddress(operator), topicAddress(owner), topicAddress(recipient)],
        [word(96), word(160), word(2), word(9), word(10), word(2), word(11), word(12)]
      ),
      { address: token, topics: [topics.transfer], data: `0x${'00'.repeat(65 * 1024)}` }
    ])
  ).toEqual({ effects: [], truncated: false })
})

it('bounds stored effects and reports truncation', () => {
  const transfer = log([topics.transfer, topicAddress(owner), topicAddress(recipient)], [word(1)])
  const result = parseSimulationEffects(Array.from({ length: 101 }, () => transfer))

  expect(result.effects).toHaveLength(100)
  expect(result.truncated).toBe(true)
})

it('bounds log inspection even when no event is recognized', () => {
  const unknown = log([`0x${'f'.repeat(64)}`])

  expect(parseSimulationEffects(Array.from({ length: 257 }, () => unknown))).toEqual({
    effects: [],
    truncated: true
  })
})
