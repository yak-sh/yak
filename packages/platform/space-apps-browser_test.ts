import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { Client } from '@yaks/client'
import { bindApps } from './space-apps-browser.ts'
import { AGENTS, brokenApps, type Listed, spaceApps } from './space-apps.ts'
import { graph } from './page-graph_fixture_test.ts'
import {
  apps,
  appsAt,
  broke,
  lines,
  NAMES,
  names,
  page,
  SPACE,
} from './space-apps_fixture_test.ts'

// The Apps page bound to a page graph holding `listed` and the rest, at an
// address a search and an order are kept in.
let bound = (
  listed: Listed[],
  ...rest: Parameters<typeof lines> extends [unknown, ...infer R] ? R : never
) => {
  let root = page(appsAt(), listed, ...rest)
  let g = graph((b: Bundle[]) => Promise.resolve(b))
  let held = lines(listed, ...rest)
  for (let [line, rows] of held) g.set(line, rows)
  let set = (...next: Parameters<typeof lines>) => {
    for (let [line, rows] of lines(...next)) g.set(line, rows)
  }
  let location = new URL('https://yaks.app/manage/ada/apps')
  let history = {
    state: null,
    replaceState: (_s: unknown, _t: string, to: URL) =>
      location.href = String(to),
  }
  bindApps(root, g, { location, history } as never)
  let ask = (name: string, value: string) => {
    let field = root.querySelector<HTMLInputElement>(`[name=${name}]`)!
    // linkedom's select has no value to set; a browser's does.
    Object.defineProperty(field, 'value', {
      value,
      configurable: true,
      writable: true,
    })
    field.dispatchEvent(
      new root.ownerDocument.defaultView!.Event('input', {
        bubbles: true,
      }),
    )
  }
  return { root, g, set, location, ask }
}

test('an app made, renamed or trashed elsewhere redraws the list without a reload', () => {
  let [kite, ark] = apps(2)
  let { root, set } = bound([kite])
  equal(names(root), ['Kite'])
  set([{ ...kite, title: 'Kites' }, ark])
  equal(names(root), ['Ark', 'Kites'])
  equal(root.querySelector('h2:not(:first-child)'), null)
  set([ark])
  equal(names(root), ['Ark'])
})

test('a break heard of shows its badge and what broke, and goes once fixed', () => {
  let listed = apps(2)
  let { root, set } = bound(listed)
  equal(root.querySelector('.Badge'), null)
  set(listed, { a0: [broke('kite is not a function')] })
  equal(root.querySelector('.Badge')?.textContent, '1 error')
  equal(
    root.querySelector('#fix-kite')!.textContent!.includes(
      'kite is not a function',
    ),
    true,
  )
  set(listed, {})
  equal(root.querySelector('#fix-kite'), null)
})

test('the connect card settles once the agents are known', () => {
  let { root, set } = bound(apps(1))
  let card = () => root.querySelector('[data-disconnected]')!
  equal(card().hasAttribute('data-unsettled'), true)
  set(apps(1), {}, 0)
  equal(
    [card().hasAttribute('hidden'), card().hasAttribute('data-unsettled')],
    [false, false],
  )
  set(apps(1), {}, 1)
  equal(card().hasAttribute('hidden'), true)
})

test('a long list narrows as a person types and orders as they pick, and the address keeps it', () => {
  let { root, ask, location } = bound(apps(10))
  ask('q', 'e')
  equal(names(root), ['Elm', 'Gem', 'Dew', 'Bee', 'Kite'])
  equal(location.searchParams.get('q'), 'e')
  ask('sort', 'name')
  equal(names(root), ['Bee', 'Dew', 'Elm', 'Gem', 'Kite'])
  equal(location.searchParams.get('sort'), 'name')
  ask('q', '')
  ask('sort', 'changed')
  equal(names(root), [...NAMES].reverse())
  equal(location.search, '')
})

test('the copy buttons show once the script that works them is here', () => {
  let { root } = bound([], {}, 1)
  let go = root.querySelector<HTMLElement>('.Copy_Go')!
  equal(go.hidden, false)
})

test('until the apps are in, the page stays as the server drew it', () => {
  let root = page(appsAt(), apps(2))
  let g = graph((b: Bundle[]) => Promise.resolve(b))
  let waiting = {
    watch: (line: string) =>
      line == spaceApps(SPACE)
        ? Object.assign(Object.create(g.watch(line)), { ready: false })
        : g.watch(line),
  } as Pick<Client, 'watch'>
  bindApps(root, waiting)
  g.set(brokenApps(SPACE), [])
  g.set(AGENTS, [])
  equal(names(root), ['Ark', 'Kite'])
})
