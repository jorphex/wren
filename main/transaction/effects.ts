const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'
const APPROVAL_FOR_ALL_TOPIC = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31'
const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'
const TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'
const WRAPPED_NATIVE_DEPOSIT_TOPIC = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c'
const WRAPPED_NATIVE_WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const MAX_INSPECTED_LOGS = 256
const MAX_EFFECTS = 100
const MAX_BATCH_ITEMS = 100
const MAX_LOG_DATA_BYTES = 64 * 1024
const WORD_HEX_LENGTH = 64

type TokenStandard = 'erc20' | 'erc721' | 'erc1155'

export type SimulationEffect =
  | {
      type: 'transfer'
      standard: TokenStandard
      token: string
      from: string
      to: string
      amount?: string
      tokenId?: string
    }
  | {
      type: 'approval'
      standard: 'erc20' | 'erc721'
      token: string
      owner: string
      spender: string
      amount?: string
      tokenId?: string
    }
  | {
      type: 'operator-approval'
      standard: 'erc721-or-erc1155'
      token: string
      owner: string
      operator: string
      approved: boolean
    }

export interface ParsedSimulationEffects {
  effects: SimulationEffect[]
  truncated: boolean
}

interface SimulationLogCandidate extends Record<string, unknown> {
  removed?: unknown
  address?: unknown
  topics?: unknown
  data?: unknown
}

function isRecord(value: unknown): value is SimulationLogCandidate {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function areTopics(values: Array<string | undefined>): values is string[] {
  return values.every((value) => value !== undefined)
}

function parseAddress(value: unknown) {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : undefined
}

function parseTopic(value: unknown) {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : undefined
}

function parseTopicAddress(value: unknown) {
  const topic = parseTopic(value)
  const match = topic?.match(/^0x0{24}([0-9a-f]{40})$/)
  return match?.[1] ? `0x${match[1]}` : undefined
}

function parseWord(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) return
  return BigInt(`0x${value}`).toString(10)
}

function parseDataWords(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_LOG_DATA_BYTES * 2 + 2 ||
    !/^0x(?:[0-9a-f]{64})*$/i.test(value)
  ) {
    return
  }

  const data = value.slice(2)
  return Array.from({ length: data.length / WORD_HEX_LENGTH }, (_, index) =>
    data.slice(index * WORD_HEX_LENGTH, (index + 1) * WORD_HEX_LENGTH)
  )
}

function parseTransfer(token: string, topics: string[], words: string[]): SimulationEffect | undefined {
  const from = parseTopicAddress(topics[1])
  const to = parseTopicAddress(topics[2])
  if (!from || !to) return

  if (topics.length === 3 && words.length === 1) {
    const amount = parseWord(words[0])
    return {
      type: 'transfer',
      standard: 'erc20',
      token,
      from,
      to,
      ...(amount !== undefined && { amount })
    }
  }
  if (topics.length === 4 && words.length === 0) {
    const tokenId = parseWord(topics[3]?.slice(2))
    if (tokenId !== undefined) return { type: 'transfer', standard: 'erc721', token, from, to, tokenId }
  }

  return undefined
}

function parseApproval(token: string, topics: string[], words: string[]): SimulationEffect | undefined {
  const owner = parseTopicAddress(topics[1])
  const spender = parseTopicAddress(topics[2])
  if (!owner || !spender) return

  if (topics.length === 3 && words.length === 1) {
    const amount = parseWord(words[0])
    return {
      type: 'approval',
      standard: 'erc20',
      token,
      owner,
      spender,
      ...(amount !== undefined && { amount })
    }
  }
  if (topics.length === 4 && words.length === 0) {
    const tokenId = parseWord(topics[3]?.slice(2))
    if (tokenId !== undefined) return { type: 'approval', standard: 'erc721', token, owner, spender, tokenId }
  }

  return undefined
}

function parseApprovalForAll(token: string, topics: string[], words: string[]): SimulationEffect | undefined {
  if (topics.length !== 3 || words.length !== 1) return

  const owner = parseTopicAddress(topics[1])
  const operator = parseTopicAddress(topics[2])
  const approved = parseWord(words[0])
  if (!owner || !operator || (approved !== '0' && approved !== '1')) return

  return {
    type: 'operator-approval',
    standard: 'erc721-or-erc1155',
    token,
    owner,
    operator,
    approved: approved === '1'
  }
}

function parseWrappedNativeTransfer(
  token: string,
  topics: string[],
  words: string[],
  withdrawal: boolean
): SimulationEffect | undefined {
  if (topics.length !== 2 || words.length !== 1) return

  const account = parseTopicAddress(topics[1])
  const amount = parseWord(words[0])
  if (!account || amount === undefined) return

  return {
    type: 'transfer',
    standard: 'erc20',
    token,
    from: withdrawal ? account : ZERO_ADDRESS,
    to: withdrawal ? ZERO_ADDRESS : account,
    amount
  }
}

function parseTransferSingle(token: string, topics: string[], words: string[]): SimulationEffect | undefined {
  if (topics.length !== 4 || words.length !== 2 || !parseTopicAddress(topics[1])) return

  const from = parseTopicAddress(topics[2])
  const to = parseTopicAddress(topics[3])
  const tokenId = parseWord(words[0])
  const amount = parseWord(words[1])
  if (!from || !to || tokenId === undefined || amount === undefined) return

  return { type: 'transfer', standard: 'erc1155', token, from, to, tokenId, amount }
}

function parseTransferBatch(
  token: string,
  topics: string[],
  words: string[]
): { effects: SimulationEffect[]; truncated: boolean } | undefined {
  if (topics.length !== 4 || words.length < 4 || !parseTopicAddress(topics[1])) return

  const from = parseTopicAddress(topics[2])
  const to = parseTopicAddress(topics[3])
  if (!from || !to) return

  const idsOffset = BigInt(`0x${words[0]}`)
  const valuesOffset = BigInt(`0x${words[1]}`)
  const itemCount = BigInt(`0x${words[2]}`)
  if (idsOffset !== 64n || itemCount > BigInt(Math.floor((words.length - 4) / 2))) return

  const count = Number(itemCount)
  const expectedValuesOffset = 96n + itemCount * 32n
  const expectedWords = 4 + count * 2
  if (
    valuesOffset !== expectedValuesOffset ||
    words.length !== expectedWords ||
    BigInt(`0x${words[3 + count]}`) !== itemCount
  ) {
    return
  }

  const decodedCount = Math.min(count, MAX_BATCH_ITEMS)
  const effects: SimulationEffect[] = []
  for (let index = 0; index < decodedCount; index += 1) {
    const tokenId = parseWord(words[3 + index])
    const amount = parseWord(words[4 + count + index])
    effects.push({
      type: 'transfer',
      standard: 'erc1155',
      token,
      from,
      to,
      ...(tokenId !== undefined && { tokenId }),
      ...(amount !== undefined && { amount })
    })
  }

  return { effects, truncated: decodedCount < count }
}

function parseLog(value: unknown): { effects: SimulationEffect[]; truncated: boolean } | undefined {
  if (!isRecord(value) || value.removed === true) return

  const token = parseAddress(value.address)
  if (!token || !Array.isArray(value.topics) || value.topics.length === 0 || value.topics.length > 4) return

  const topics = value.topics.map(parseTopic)
  const words = parseDataWords(value.data)
  if (!areTopics(topics) || !words) return

  const topic = topics[0]
  const effect =
    topic === TRANSFER_TOPIC
      ? parseTransfer(token, topics, words)
      : topic === APPROVAL_TOPIC
        ? parseApproval(token, topics, words)
        : topic === APPROVAL_FOR_ALL_TOPIC
          ? parseApprovalForAll(token, topics, words)
          : topic === TRANSFER_SINGLE_TOPIC
            ? parseTransferSingle(token, topics, words)
            : topic === WRAPPED_NATIVE_DEPOSIT_TOPIC
              ? parseWrappedNativeTransfer(token, topics, words, false)
              : topic === WRAPPED_NATIVE_WITHDRAWAL_TOPIC
                ? parseWrappedNativeTransfer(token, topics, words, true)
                : undefined

  if (effect) return { effects: [effect], truncated: false }
  if (topic === TRANSFER_BATCH_TOPIC) return parseTransferBatch(token, topics, words)
  return undefined
}

export function parseSimulationEffects(value: unknown): ParsedSimulationEffects {
  if (!Array.isArray(value)) return { effects: [], truncated: false }

  const effects: SimulationEffect[] = []
  let truncated = value.length > MAX_INSPECTED_LOGS

  const inspectedLogs = value.slice(0, MAX_INSPECTED_LOGS)
  for (const [index, log] of inspectedLogs.entries()) {
    const parsed = parseLog(log)
    if (!parsed) continue

    truncated ||= parsed.truncated
    const remaining = MAX_EFFECTS - effects.length
    if (parsed.effects.length > remaining) truncated = true
    effects.push(...parsed.effects.slice(0, remaining))

    if (effects.length === MAX_EFFECTS) {
      truncated ||= index < inspectedLogs.length - 1
      break
    }
  }

  return { effects, truncated }
}
