import { toRpcQuantity } from '../../../resources/domain/transaction/quantity'
import { feeHistoryPolicy } from '../policy'

import type { GasFees } from '../../store/state'

interface GasCalculator {
  calculateGas: (blocks: Block[]) => GasFees
}

type CalcOpts = Partial<{
  percentileBand: number
  averageMethod: 'average' | 'median'
}>

type RawGasFees = {
  nextBaseFee: bigint
  maxBaseFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  maxFeePerGas: bigint
}

export type Block = {
  baseFee: bigint
  rewards: bigint[]
  gasUsedRatio?: number
}

const POLYGON_MIN_PRIORITY_FEE = 25_000_000_000n

function feesToHex(fees: RawGasFees) {
  return {
    nextBaseFee: toRpcQuantity(fees.nextBaseFee),
    maxBaseFeePerGas: toRpcQuantity(fees.maxBaseFeePerGas),
    maxPriorityFeePerGas: toRpcQuantity(fees.maxPriorityFeePerGas),
    maxFeePerGas: toRpcQuantity(fees.maxFeePerGas)
  }
}

function calculateReward(blocks: Block[], opts: CalcOpts = {}) {
  const recentBlocks = 10
  const { percentileBand = 0, averageMethod = 'median' } = opts
  const allBlocks = blocks.length

  // these strategies will be tried in descending order until one finds
  // at least 1 eligible block from which to calculate the reward
  const rewardCalculationStrategies = [
    // use recent blocks that weren't almost empty or almost full
    { minRatio: 0.1, maxRatio: 0.9, blockSampleSize: recentBlocks },
    // include recent blocks that were full
    { minRatio: 0.1, maxRatio: 1.05, blockSampleSize: recentBlocks },
    // use the entire block sample but still limit to blocks that were not almost empty
    { minRatio: 0.1, maxRatio: 1.05, blockSampleSize: allBlocks },
    // use any recent block with transactions
    { minRatio: 0, maxRatio: Number.MAX_SAFE_INTEGER, blockSampleSize: recentBlocks },
    // use any block with transactions
    { minRatio: 0, maxRatio: Number.MAX_SAFE_INTEGER, blockSampleSize: allBlocks }
  ]

  const eligibleRewardsBlocks = rewardCalculationStrategies.reduce((foundBlocks, strategy) => {
    if (foundBlocks.length === 0) {
      const blockSample = blocks.slice(blocks.length - Math.min(strategy.blockSampleSize, blocks.length))
      const eligibleBlocks = blockSample.filter((block) => {
        const ratio = block.gasUsedRatio
        return ratio !== undefined && ratio > strategy.minRatio && ratio <= strategy.maxRatio
      })

      if (eligibleBlocks.length > 0) return eligibleBlocks
    }

    return foundBlocks
  }, [] as Block[])

  const rewardAtBand = (block: Block) => block.rewards[Math.min(percentileBand, block.rewards.length - 1)]
  const lastBlock = blocks[blocks.length - 1]
  const lastBlockFee = lastBlock ? (rewardAtBand(lastBlock) ?? 0n) : 0n
  const eligibleRewards = eligibleRewardsBlocks.map(rewardAtBand).filter((reward) => reward !== undefined)

  if (eligibleRewards.length === 0) return lastBlockFee
  if (averageMethod === 'average') {
    return eligibleRewards.reduce((sum, reward) => sum + reward, 0n) / BigInt(eligibleRewards.length)
  }

  // Keep the existing upper-median convention for an even number of samples.
  const sortedRewards = eligibleRewards.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const medianReward = sortedRewards[Math.floor(sortedRewards.length / 2)]
  return medianReward ?? lastBlockFee
}

function estimateGasFees(blocks: Block[], opts: CalcOpts = {}) {
  if (blocks.length < 2) throw new Error('Fee history requires at least one completed block')

  const normalizedBlocks = blocks.map((block) => ({
    ...block,
    baseFee: BigInt(block.baseFee),
    rewards: block.rewards.map((reward) => BigInt(reward))
  }))

  // plan for max fee of 2 full blocks, each one increasing the fee by 12.5%
  const nextBlock = normalizedBlocks[normalizedBlocks.length - 1]
  if (!nextBlock) throw new Error('Fee history has no next-block base fee')
  const nextBlockFee = nextBlock.baseFee // base fee for next block
  const calculatedFee = (nextBlockFee * 81n + 63n) / 64n

  // the last block contains only the base fee for the next block but no fee history, so
  // don't use it in the block reward calculation
  const medianBlockReward = calculateReward(normalizedBlocks.slice(0, normalizedBlocks.length - 1), opts)

  const estimatedGasFees: RawGasFees = {
    nextBaseFee: nextBlockFee,
    maxBaseFeePerGas: calculatedFee,
    maxPriorityFeePerGas: medianBlockReward,
    maxFeePerGas: calculatedFee + medianBlockReward
  }

  return estimatedGasFees
}

function DefaultGasCalculator() {
  return {
    calculateGas: (blocks: Block[]) => {
      const estimatedGasFees = estimateGasFees(blocks)

      return feesToHex(estimatedGasFees)
    }
  }
}

function PolygonGasCalculator() {
  return {
    calculateGas: (blocks: Block[]) => {
      const fees = estimateGasFees(blocks)

      const maxPriorityFeePerGas =
        fees.maxPriorityFeePerGas > POLYGON_MIN_PRIORITY_FEE
          ? fees.maxPriorityFeePerGas
          : POLYGON_MIN_PRIORITY_FEE

      return feesToHex({
        ...fees,
        maxPriorityFeePerGas,
        maxFeePerGas: fees.maxBaseFeePerGas + maxPriorityFeePerGas
      })
    }
  }
}

function OpStackGasCalculator() {
  return {
    calculateGas: (blocks: Block[]) => {
      const estimatedGasFees = estimateGasFees(blocks, { percentileBand: 1, averageMethod: 'average' })

      return feesToHex(estimatedGasFees)
    }
  }
}

export function createGasCalculator(chainId: string | number = 0): GasCalculator {
  const policy = feeHistoryPolicy(chainId)
  if (policy === 'polygon') {
    // Polygon PoS mainnet requires a minimum priority fee.
    return PolygonGasCalculator()
  }

  if (policy === 'op-stack') {
    return OpStackGasCalculator()
  }

  return DefaultGasCalculator()
}
