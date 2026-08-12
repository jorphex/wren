import Restore from 'react-restore'
import state from './state'
import * as actions from './actions'
import persist from './persist'
import { isPersistedStatePath } from './persist/path'

const store = Restore.create(state(), actions)

persist.pruneTransientState()

// Persist initial full state
persist.set('main', store('main'))

// Apply updates to persisted state
store.api.feed((state, actionBatch) => {
  actionBatch.forEach((action) => {
    action.updates.forEach((update) => {
      if (isPersistedStatePath(update.path)) {
        persist.queue(update.path, update.value)
      }
    })
  })
})

export default store
