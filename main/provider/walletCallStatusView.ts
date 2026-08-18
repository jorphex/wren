import { requireStoreAction } from '../store/action'
import windows from '../windows'
import type { WalletCallStatusViewData } from '../windows/nav/breadcrumb'
import type { WalletCallsStatus } from './walletCallBatches'

interface ShowWalletCallStatusInput {
  account: string
  originName: string
  status: WalletCallsStatus
  callCount?: number
  submittedCount?: number
}

export function createWalletCallStatusViewData({
  account,
  originName,
  status,
  callCount,
  submittedCount
}: ShowWalletCallStatusInput): WalletCallStatusViewData {
  const receipts = status.receipts?.map(
    ({ status, type, blockNumber, gasUsed, effectiveGasPrice, transactionHash }) => ({
      status,
      ...(type ? { type } : {}),
      blockNumber,
      gasUsed,
      ...(effectiveGasPrice ? { effectiveGasPrice } : {}),
      transactionHash
    })
  )

  return {
    accountId: account.toLowerCase(),
    originName,
    status: {
      version: status.version,
      id: status.id,
      chainId: status.chainId,
      status: status.status,
      atomic: false,
      ...(Number.isInteger(callCount) &&
      (callCount as number) >= 1 &&
      (callCount as number) <= 16 &&
      Number.isInteger(submittedCount) &&
      (submittedCount as number) >= 0 &&
      (submittedCount as number) <= (callCount as number)
        ? {
            callCount,
            submittedCount,
            confirmedCount: Math.min(
              submittedCount as number,
              receipts?.filter((receipt) => receipt.status === '0x1').length || 0
            )
          }
        : {}),
      ...(receipts?.length ? { receipts } : {})
    }
  }
}

export function showWalletCallStatus(input: ShowWalletCallStatusInput) {
  const data = createWalletCallStatusViewData(input)
  requireStoreAction('showWalletCallsStatus')(data.accountId, data)
  windows.showTray()
}
