/* globals */

import EventEmitter from 'events'
import Restore from 'react-restore'

import link from '../resources/link'

// const actions = {
//   initialSignerPos: (u, pos) => u('selected.position.initial', () => pos),
//   initialScrollPos: (u, pos) => u('selected.position.scrollTop', () => pos)
// }

import * as actions from '../resources/store/actions.panel'

export default (state, { signal } = {}) => {
  const store = Restore.create(state, actions)
  store.events = new EventEmitter()

  // Feed for relaying state updates
  // store.api.feed((state, actions, obscount) => {
  //   actions.forEach(action => {
  //     action.updates.forEach(update => {
  //       // console.log(update)
  //       // if (update.path.startsWith('main')) return
  //       // if (update.path.startsWith('panel')) return
  //       // link.send('tray:syncPath', update.path, update.value)
  //     })
  //   })
  // })

  const onAction = (action, ...args) => {
    if (store[action]) store[action](...args)
  }
  link.on('action', onAction)
  signal?.addEventListener('abort', () => link.off('action', onAction), { once: true })

  return store
}
