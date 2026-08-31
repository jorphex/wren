import { rendererVisibleActions, rendererVisibleState } from '../../../main/store/rendererPrivacy'

it('removes private Activity lifecycle state from the renderer bootstrap state', () => {
  expect(
    rendererVisibleState({
      main: {
        activity: [{ id: 'visible-summary' }],
        activityClearedAt: 1234,
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
