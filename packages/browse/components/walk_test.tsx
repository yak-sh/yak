// Vim's keys on the web page (@yaks/ux/keys). A linkedom document lays
// nothing out, so the walk here keeps to reading order; where each item sits
// is the terminal's test (../tui/walk_test.ts) and @yaks/ux's. j puts the
// cursor on the page, never the focus; the sidebar is on the same walk; Enter
// on a link peeks it, the keys walk the peek, and Esc or q closes it with the
// cursor back on the link; a field is walked onto without typing into it, i
// types into it in insert mode, and Esc leaves it with the cursor on it.
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
  let held = () => document.activeElement
  let cursor = () => root.querySelector('[data-cursor]')
  // A key as a browser sends it: a keydown on what holds the focus.
  let press = async (key: string) => {
    let e = Object.assign(
      new window.Event('keydown', { bubbles: true, cancelable: true }),
      { key },
    )
    await act(() => void (held() ?? document.body).dispatchEvent(e))
    return e.defaultPrevented
  }
  let point = (n: Element) =>
    act(() =>
      void n.dispatchEvent(
        new window.Event('pointerdown', { bubbles: true }),
      )
    )
  let peeking = () => !!root.querySelector('.Peek')
  try {
    await act(() => render(h(Ux, { host: ux }, h(App, {})), root))
    await until(() => !!root.querySelector('a[href="/T-2"]'))
    await press('j')
    let page = [!!cursor()?.closest('.Shell_Main'), held()]
    await press('g')
    await press('g')
    let side = !!cursor()?.closest('.Shell_Side')
    let link = root.querySelector('a[href="/T-2"]')!
    await point(link)
    await press('Enter')
    await until(peeking)
    let peek = peeked.value?.eid
    await press('j')
    let walksPeek = !!cursor()?.closest('.Peek')
    await press('Escape')
    let esc = [peeking(), cursor() == link]
    await press('Enter')
    await until(peeking)
    await press('q')
    let q = [peeking(), cursor() == link]
    let field = root.querySelector('textarea')
    for (let n = 0; n < 60 && cursor() != field; n++) await press('j')
    let onto = [cursor() == field, held()]
    await press('i')
    let insert = [held() == field, mode.value]
    let typed = await press('j')
    await press('Escape')
    let left = [mode.value, held(), cursor() == field]
    return { page, side, peek, walksPeek, esc, q, onto, insert, typed, left }
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

test('j puts the cursor on the page, not the focus; gg reaches the sidebar', () => {
  equal(seen.page, [true, null])
  equal(seen.side, true)
})

test('Enter on a link peeks it, and the keys walk the peek while it is up', () => {
  equal(seen.peek, two)
  equal(seen.walksPeek, true)
})

test('Esc and q close the peek, the cursor back on its link', () => {
  equal([seen.esc, seen.q], [[false, true], [false, true]])
})

test('a field is walked onto, typed into after i, and left by Esc with the cursor on it', () => {
  equal(seen.onto, [true, null])
  equal(seen.insert, [true, 'insert'])
  equal(seen.typed, false)
  equal(seen.left, ['normal', null, true])
})
