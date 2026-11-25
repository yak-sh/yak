import type { Bundle } from '@yaks/graph'
import { renderToString } from 'preact-render-to-string'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import {
  type OperatorRows,
  operatorSettingsView,
  type OperatorView,
} from './operator-settings-view.ts'
import {
  ALERTING,
  alertingRow,
  operatorSettings,
  settingsRow,
  TEXTING,
  textingRows,
} from './operator-settings.ts'
import { ACCOUNT, accountRow } from './account-rows.ts'

export let SPACE = 'space-ada'
export let ADA = 'person-ada'
export let AT = '/manage/ada/operator'

let voice = (id: string, ways: string[]) => ({
  id,
  name: id,
  about: '',
  provider: 'p',
  ways,
})

/** Ada's own space's settings page, as the server says it beside the rows. */
export let operatorView = (over: Partial<OperatorView> = {}): OperatorView => ({
  person: ADA,
  space: { eid: SPACE, slug: 'ada' },
  at: AT,
  connections: '/manage/ada/connections',
  operator: 'Elihu',
  pa: true,
  beyond: [],
  address: 'ada@yaks.app',
  offer: {
    setup: {
      voice: 'draco',
      pace: 'calm',
      model: 'phone',
      backend: 'operator',
    },
    voices: [voice('draco', ['phone']), voice('marin', ['phone', 'live'])],
    ways: [
      { model: 'phone', name: 'Phone', about: '' },
      { model: 'live', name: 'Live', about: '' },
    ],
    paces: [{ id: 'calm', name: 'Calm', about: '' }],
    backends: [{ id: 'operator', name: 'Operator', about: '' }],
  } as never,
  key: null,
  chats: [],
  ...over,
})

/** The rows the page is drawn from. */
export let operatorRows = (over: Partial<OperatorRows> = {}): OperatorRows => ({
  settings: { name: 'Elihu' },
  alerting: { channel: null, by: 'email', browsers: 0 },
  texting: null,
  email: 'ada@example.test',
  ...over,
})

/** The settings view `view` drawn from `rows` as a server draws it. */
export let page = (
  view = operatorView(),
  rows = operatorRows(),
): HTMLElement => {
  let html = renderToString(
    h(
      'div',
      {
        'data-view': 'operator-settings',
        'data-operator-view': JSON.stringify(view),
      },
      operatorSettingsView(view, rows),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}

/** Each line's rows in a page graph, from `rows`. */
export let lines = (rows = operatorRows()): [string, Bundle[]][] => [
  [operatorSettings(SPACE), [settingsRow(SPACE, rows.settings)]],
  [ALERTING, [alertingRow(ADA, rows.alerting)]],
  [TEXTING, textingRows(ADA, rows.texting)],
  [ACCOUNT, [
    accountRow(ADA, { name: 'Ada', email: rows.email ?? '', hidden: false }),
  ]],
]
