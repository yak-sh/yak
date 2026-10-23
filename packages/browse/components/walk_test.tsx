// Vim's keys on the web page (@yaks/ux/keys): they walk the page, not the
// sidebar; Enter on a link peeks it as a press does; they walk the peek while
// it is up; Esc puts it away and hands the focus back to the link; and they
// rest in insert mode and in a field typed into. A linkedom document lays
// nothing out, so the walk here keeps to reading order; where each item sits
// is the terminal's test (../tui/walk_test.ts) and @yaks/ux's.
import { test, until } from '../testing.ts'
import { equal } from '@yaks/testing'
import '../domain-host.tsx'
import './mount.ts'
import { h, options, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { terminalHistory } from '@yaks/tui/history'
import { Ux } from '@yaks/ux'
import { App } from './App.tsx'
import { wire } from './nav.tsx'
import { ux } from './registry.ts'
import { bindHistory } from '../history.ts'
import { cache, config, mode, owner, peeked } from '../live.ts'
import { host } from '../host_testing.ts'

let one = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let two = 'bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let seen = await (async () => {
  let { document, window } = parseHTML('<html><body></body></html>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let media = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
  let size = {
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  }
  let raf = options.requestAnimationFrame
  let before = config.host, fetcher = globalThis.fetch
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'matchMedia', {
    value: (q: string) => ({ matches: q == '(pointer: fine)' }),
    configurable: true,
  })
  Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 })
  options.requestAnimationFrame = (fn) => setTimeout(fn, 0)
  config.host = 'walk.test'
  globalThis.fetch = () => Promise.resolve(Response.json([]))
  let server = host(() => ({
    bundles: [{
      entity: { eid: one, num: 1 },
      task: { eid: one },
      doc: { eid: one, title: 'One task', body: 'Words about T-2' },
    }, {
      entity: { eid: two, num: 2 },
      task: { eid: two },
      doc: { eid: two, title: 'Two task', body: 'Two' },
    }],
  }))
  owner.value = undefined
  mode.value = 'normal'
  let port = terminalHistory({ path: '/', state: null })
  port.write({ path: '/T-1', state: null })
  bindHistory(port)
  let root = document.createElement('main')
  document.body.append(root)
  wire(document as unknown as Parameters<typeof wire>[0])
  let held = () => document.activeElement as HTMLElement | null
  // A key as a browser sends it, in a mode: a keydown on what holds the
  // focus, then, for Enter on a link or a button nobody took, a press.
  let press = async (key: string, as: 'normal' | 'insert' = 'normal') => {
    mode.value = as
    let at = (held() ?? document.body) as HTMLElement
    let e = Object.assign(
      new window.Event('keydown', { bubbles: true, cancelable: true }),
      { key },
    )
    await act(() => {
      at.dispatchEvent(e)
      if (key == 'Enter' && !e.defaultPrevented && at.matches('a, button')) {
        at.click()
      }
    })
    return e.defaultPrevented
  }
  let inside = (part: string) => !!held()?.closest(part)
  try {
    await act(() => render(h(Ux, { host: ux }, h(App, {})), root))
    await until(() => !!root.querySelector('a[href="/T-2"]'))
    await press('j')
    let page = inside('.Shell_Main') && !inside('.Shell_Side')
    let link = root.querySelector('a[href="/T-2"]') as HTMLElement
    link.focus()
    await press('Enter')
    await until(() => !!root.querySelector('.Peek'))
    let peek = peeked.value?.eid
    await press('j')
    let walksPeek = inside('.Peek')
    await press('Escape')
    let after = { peek: !!root.querySelector('.Peek'), link: held() == link }
    let insert = await press('j', 'insert')
    ;(root.querySelector('textarea') as HTMLElement).focus()
    let typing = await press('j')
    return { page, peek, walksPeek, after, insert, typing }
  } finally {
    render(null, root)
    mode.value = 'normal'
    server.free()
    peeked.value = null
    cache.value = {}
    config.host = before
    globalThis.fetch = fetcher
    options.requestAnimationFrame = raf
    Object.assign(globalThis, size)
    if (media) Object.defineProperty(globalThis, 'matchMedia', media)
    else delete (globalThis as { matchMedia?: unknown }).matchMedia
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})()

test('j walks the page, not the sidebar beside it', () => {
  equal(seen.page, true)
})

test('Enter on a link peeks it, and the keys walk the peek while it is up', () => {
  equal(seen.peek, two)
  equal(seen.walksPeek, true)
})

test('Esc puts the peek away and hands the focus back to its link', () => {
  equal(seen.after, { peek: false, link: true })
})

test('the keys rest in insert mode and in a field typed into', () => {
  equal([seen.insert, seen.typing], [false, false])
})
