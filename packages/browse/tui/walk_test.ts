// Vim's keys in the terminal: the one App, painted, walked by where each item
// sits (@yaks/ux/keys), its keydowns sent by the terminal's interaction.
import './doc.ts'
import { until } from '../testing.ts'
import '../domain-host.tsx'
import { equal, ok, test } from '@yaks/testing'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { doc, TElement } from '@yaks/tui'
import { interaction } from '@yaks/tui/interaction'
import { terminalHistory } from '@yaks/tui/history'
import { installViewport } from '@yaks/ui'
import { Ux } from '@yaks/ux'
import type { Box } from '@yaks/ux/keys'
import { App } from '../components/App.tsx'
import { ux } from '../components/registry.ts'
import { bindHistory } from '../history.ts'
import { cache, config, mode, owner } from '../live.ts'
import { host } from '../host_testing.ts'
import { paint } from './testing.ts'

let one = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let two = 'bbbbbbbb-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

// The page of T-1, walked: where the first j lands, the box each move left
// and the box it landed on, what was painted inverse at the end, and where H
// went.
let walked = await (async () => {
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  let port = terminalHistory({ path: '/', state: null })
  let before = config.host, fetcher = globalThis.fetch
  config.host = 'walk.test'
  globalThis.fetch = () => Promise.resolve(Response.json([]))
  port.write({ path: '/T-1', state: null })
  let rows = [{
    entity: { eid: one, num: 1 },
    task: { eid: one },
    doc: { eid: one, title: 'One task', body: 'Words about T-2' },
  }, {
    entity: { eid: two, num: 2 },
    task: { eid: two },
    doc: { eid: two, title: 'Two task', body: 'Two' },
  }]
  let server = host(() => ({ bundles: rows }))
  owner.value = undefined
  mode.value = 'normal'
  bindHistory(port)
  installViewport(({ children, ...props }) => h('div', props, children))
  let keys = interaction(root, () => {})
  let press = (text: string) =>
    act(() => void keys.press({ name: 'char', text }))
  let box = () => doc.activeElement?.getBoundingClientRect()
  try {
    await act(() =>
      render(h(Ux, { host: { ...ux, Float: undefined } }, h(App, {})), target)
    )
    await until(() => root.textContent.includes('assignee'))
    paint(root)
    await press('j')
    let page = !!doc.activeElement?.closest('.Shell_Main')
    let moves = []
    for (let key of ['j', 'l', 'h', 'k']) {
      let from = box()!
      await press(key)
      moves.push({ key, from, to: box()! })
    }
    let held = doc.activeElement?.textContent ?? ''
    let inverse = paint(root).flatMap((line) =>
      line.filter((s) => s.style.inverse).map((s) => s.text)
    ).join('')
    await press('H')
    return { page, moves, held, inverse, back: port.read().path }
  } finally {
    render(null, target)
    server.free()
    cache.value = {}
    config.host = before
    globalThis.fetch = fetcher
  }
})()

// Whether the box a move lands on lies that way of the box it left, as the
// terminal painted them: wholly below, above, or beside it on its line.
let lies = (key: string, a: Box, b: Box) =>
  key == 'j'
    ? b.top >= a.bottom
    : key == 'k'
    ? b.bottom <= a.top
    : (key == 'l' ? b.left >= a.right : b.right <= a.left) &&
      b.top < a.bottom && b.bottom > a.top

test('j starts on the page, and each of hjkl lands on an item that lies that way', () => {
  equal(walked.page, true)
  equal(
    walked.moves.map(({ key, from, to }) => [key, lies(key, from, to)]),
    [['j', true], ['l', true], ['h', true], ['k', true]],
  )
})

test('the item in focus paints inverse, and H goes back', () => {
  ok(walked.held && walked.inverse.includes(walked.held), walked.inverse)
  equal(walked.back, '/')
})
