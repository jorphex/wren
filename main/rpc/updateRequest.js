export const applyRequestUpdate = (accounts, reqId, data, actionId, accountId) => {
  if (!accounts.updateRequest(reqId, data, actionId, accountId)) {
    throw new Error('Request update was not applied')
  }
}
