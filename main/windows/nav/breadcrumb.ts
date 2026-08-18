export interface Breadcrumb<Data = unknown> {
  view: string
  data: Data
}

type Step = 'confirm'

interface RequestData {
  step: Step
  accountId: string
  requestId: string
}

export interface RequestBreadcrumb extends Breadcrumb<RequestData> {
  view: 'requestView'
  data: RequestData
}

export interface WalletCallStatusViewData {
  accountId: string
  originName: string
  status: {
    version: '2.0.0'
    id: string
    chainId: string
    status: 100 | 200 | 400 | 500 | 600
    atomic: false
    callCount?: number
    submittedCount?: number
    confirmedCount?: number
    receipts?: Array<{
      status: '0x0' | '0x1'
      type?: '0x0' | '0x1' | '0x2'
      blockNumber: string
      gasUsed: string
      effectiveGasPrice?: string
      transactionHash: string
    }>
  }
}

export interface WalletCallsStatusBreadcrumb extends Breadcrumb<WalletCallStatusViewData> {
  view: 'walletCallsStatus'
  data: WalletCallStatusViewData
}
