import { requireStoreAction } from '../store/action'
import windows from '../windows'
import type { WalletCallStatusViewData } from '../windows/nav/breadcrumb'
import type { WalletCallsStatus } from './walletCallBatches'

interface ShowWalletCallStatusInput {
  account: string
  originName: string
  status: WalletCallsStatus
}

export function createWalletCallStatusViewData({
  account,
  originName,
  status
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
      ...(receipts?.length ? { receipts } : {})
    }
  }
}

export function showWalletCallStatus(input: ShowWalletCallStatusInput) {
  const data = createWalletCallStatusViewData(input)
  requireStoreAction('showWalletCallsStatus')(data.accountId, data)
  windows.showTray()
}
