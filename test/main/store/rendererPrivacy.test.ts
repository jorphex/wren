import { rendererVisibleActions, rendererVisibleState } from '../../../main/store/rendererPrivacy'

it('removes retained Activity transaction references from the renderer bootstrap state', () => {
  expect(
    rendererVisibleState({
      main: {
        activity: [{ id: 'visible-summary' }],
        activityTransactionReferences: { private: { hash: '0xprivate' } }
      },
      selected: { open: true }
    })
  ).toEqual({
    main: { activity: [{ id: 'visible-summary' }] },
    selected: { open: true }
  })
})

it('drops private reference updates while preserving unrelated renderer state updates', () => {
  expect(
    rendererVisibleActions([
      {
        name: 'recordActivityTransactionReference',
        updates: [
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
