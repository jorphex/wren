import { rendererVisibleActions, rendererVisibleState } from '../../../main/store/rendererPrivacy'

it('removes private Activity lifecycle state from the renderer bootstrap state', () => {
  expect(
    rendererVisibleState({
      main: {
        activity: [{ id: 'visible-summary' }],
        activityClearedAt: 1234,
        accountActivityCursors: { 1: { number: 20, notified: ['hash'] } },
        activityTransactionReferences: { private: { hash: '0xprivate' } }
      },
      selected: { open: true }
    })
  ).toEqual({
    main: { activity: [{ id: 'visible-summary' }] },
    selected: { open: true }
  })
})

it('drops private Activity updates while preserving unrelated renderer state updates', () => {
  expect(
    rendererVisibleActions([
      {
        name: 'recordActivityTransactionReference',
        updates: [
          { path: 'main.activityClearedAt', value: 1234 },
          { path: 'main.accountActivityCursors.1', value: { number: 20 } },
          { path: 'main.activityTransactionReferences', value: { private: true } },
          { path: 'main.activity', value: [{ id: 'visible-summary' }] }
        ]
      },
      {
        name: 'replaceMain',
        updates: [
          {
            path: 'main',
            value: {
              activity: [],
              activityClearedAt: 1234,
              accountActivityCursors: { 1: { number: 20, notified: ['hash'] } },
              activityTransactionReferences: { private: true },
              accounts: {}
            }
          }
        ]
      }
    ])
  ).toEqual([
    {
      name: 'recordActivityTransactionReference',
      updates: [{ path: 'main.activity', value: [{ id: 'visible-summary' }] }]
    },
    {
      name: 'replaceMain',
      updates: [{ path: 'main', value: { activity: [], accounts: {} } }]
    }
  ])
})

it('keeps observed transaction evidence behind the Activity details lookup', () => {
  const entry = {
    id: 'summary',
    observed: {
      action: 'received',
      source: 'external',
      hash: 'private-hash',
      from: 'private-sender',
      blockHash: 'private-block',
      blockNumber: 10
    }
  }
  const summary = { id: 'summary', observed: { action: 'received', source: 'external' } }
  expect(rendererVisibleState({ main: { activity: [entry] } })).toEqual({ main: { activity: [summary] } })
  expect(
    rendererVisibleActions([
      {
        name: 'commitAccountActivity',
        updates: [
          { path: 'main.activity', value: [entry] },
          { path: 'main.activity.0.observed.hash', value: 'private-hash' }
        ]
      }
    ])
  ).toEqual([{ name: 'commitAccountActivity', updates: [{ path: 'main.activity', value: [summary] }] }])
})
