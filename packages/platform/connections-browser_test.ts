import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { WriteRefused } from '@yaks/client'
import { bindConnections } from './connections-browser.ts'
import {
  actedRow,
  type Connections,
  connectionsPage,
  pageRow,
} from './connections-page.ts'
import { graph } from './page-graph_fixture_test.ts'
import { SAVE_THROUGH, type SavingForm } from './page-parts.ts'
import {
  connections,
  connectionsViewOf,
  face,
  offered,
  page,
  shown,
  SPACE,
} from './connections_fixture_test.ts'

// A window at `at`: where it is, what it went to, and its history.
let windowAt = (at: string) => {
  let location = Object.assign(new URL(at), {
    assign: (to: string) => went.push(to),
  })
  let went: string[] = []
  let move = (_: unknown, __: string, to: string) => {
    let next = new URL(to, location.href)
    location.search = next.search
    location.hash = next.hash
  }
  return {
    went,
    win: {
      location,
      history: { pushState: move, replaceState: move },
      addEventListener: () => {},
    } as unknown as Window,
  }
}

// The page bound to a page graph holding `c` on its line, each press
// answered by `answer`, its address `at`.
let bound = (
  { c = connections(), answer = ok, at = '' }: {
    c?: Connections
    answer?: (b: Bundle[]) => Promise<Bundle[]>
    at?: string
  } = {},
) => {
  let root = page(connectionsViewOf(), c)
  let dialog = root.querySelector('dialog')!
  Object.assign(dialog, {
    close: () => dialog.removeAttribute('open'),
    showModal: () => dialog.setAttribute('open', ''),
  })
  let g = graph(answer)
  let held = (ask: string, next: Connections) =>
    g.set(connectionsPage(SPACE, ask), [pageRow(SPACE, ask, next)])
  held('', c)
  let { win, went } = windowAt(`https://yaks.test/manage/ada/connections${at}`)
  let asked: string[] = []
  let watch = g.watch
  g.watch = ((line: string) => (asked.push(line), watch(line))) as typeof watch
  bindConnections(root, g, win)
  let doc = root.ownerDocument
  let shownBody = () =>
    root.querySelector('dialog .Modal_Body:not([hidden]) h2')?.textContent ??
      null
  // A press of the Save bar of the weather connection's key form.
  let press = (fields: Record<string, string>) => {
    let body = new FormData()
    for (let [k, v] of Object.entries(fields)) body.set(k, v)
    return root.querySelector<SavingForm>(
      '[data-connection="c-weather"] form[data-save]',
    )![SAVE_THROUGH]!(body)
  }
  let click = (link: Element) =>
    link.dispatchEvent(
      Object.assign(
        new doc.defaultView!.Event('click', {
          bubbles: true,
          cancelable: true,
        }),
        { button: 0 },
      ),
    )
  return { root, g, held, asked, went, win, shownBody, press, click }
}
let ok = (b: Bundle[]) =>
  Promise.resolve([actedRow(b[0].entity.eid, { say: 'Saved.' })])

test('a connection changed elsewhere is drawn again as its row moves', () => {
  let { root, held } = bound({
    c: connections({ list: [shown('weather', 'broken')] }),
  })
  let state = () => root.querySelector('.Card .State')?.textContent ?? null
  equal(state(), 'Needs reconnecting')
  held('', connections())
  equal(state(), 'Connected')
})

test('the hash opens what the row holds at once, and asks the server for the rest', () => {
  let { asked, shownBody } = bound({ at: '#cal' })
  equal(shownBody(), 'Connect cal')
  equal(asked.length, 1)
  let b = bound({ at: '#hubspot' })
  equal(b.asked.at(-1), connectionsPage(SPACE, 'detail=hubspot'))
  equal(b.shownBody(), 'Connection details')
  let hubspot = {
    ...offered('hubspot'),
    face: { ...face('hubspot', 'HubSpot') },
  }
  b.held('detail=hubspot', connections({ open: 'hubspot', asked: hubspot }))
  equal(b.shownBody(), 'Connect HubSpot')
})

test('a dialog keeps its very fields when it closes and opens again, so what is typed stays', () => {
  let { root, win, shownBody, click } = bound({ at: '#weather' })
  let key = root.querySelector<HTMLInputElement>(
    '[data-connection="c-weather"] input[name=key]',
  )!
  click(root.querySelector('dialog [data-modal-close]')!)
  equal([shownBody(), win.location.hash], [null, ''])
  click(root.querySelector('a[href$="#weather"]')!)
  equal(shownBody(), 'weather')
  equal(
    root.querySelector('[data-connection="c-weather"] input[name=key]'),
    key,
  )
})

test('a press is written as an act at the page’s address, and says what the door said of it', async () => {
  let { g, press } = bound({ at: '?enable=cal#weather' })
  equal(await press({ do: 'key', connection: 'c-weather', key: 'k' }), 'Saved.')
  equal(g.wrote.map((b) => b.map((one) => one.connectionAct)), [[{
    space: SPACE,
    page: '/manage/ada/connections?enable=cal',
    form: { do: 'key', connection: 'c-weather', key: 'k' },
  }]])
})

test('a refusal is said where the press was made, and a sign-in goes to the service', async () => {
  let refused = (b: Bundle[]) =>
    Promise.reject(
      new WriteRefused(b, {
        error: 'arguments',
        message: 'Paste the key first.',
      } as never),
    )
  let no = bound({ at: '#weather', answer: refused })
  equal(
    await no.press({ do: 'key' }).catch((e) => e.message),
    'Paste the key first.',
  )
  let away = bound({
    at: '#weather',
    answer: (b) =>
      Promise.resolve([
        actedRow(b[0].entity.eid, { go: 'https://service.test/authorize' }),
      ]),
  })
  await away.press({ do: 'signin' })
  equal(away.went, ['https://service.test/authorize'])
})

test('a kind of service, the search and the trash ask the row again', () => {
  let { asked, click, root } = bound({
    c: connections({
      catalog: {
        q: '',
        featured: [],
        found: [],
        matched: 0,
        total: 3,
        kinds: [{ name: 'crm', label: 'CRM' }],
      },
    }),
  })
  click(root.querySelector('.Chip[href*="q=crm"]')!)
  equal(asked.at(-1), connectionsPage(SPACE, 'q=crm'))
})

test('a service the row was read for closes, and stays closed as the row moves', () => {
  let b = bound({ at: '#hubspot' })
  let hubspot = { ...offered('hubspot'), face: face('hubspot', 'HubSpot') }
  let read = connections({ open: 'hubspot', asked: hubspot })
  b.held('detail=hubspot', read)
  equal(b.shownBody(), 'Connect HubSpot')
  b.click(
    b.root.querySelector(
      'dialog .Modal_Body:not([hidden]) [data-modal-close]',
    )!,
  )
  equal(b.shownBody(), null)
  b.held('detail=hubspot', { ...read, list: [] })
  equal(b.shownBody(), null)
})
