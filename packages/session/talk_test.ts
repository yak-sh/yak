// A session's Conversation view asks for its entries and draws each line as
// every transcript does: a call and the result that answered it are one line.
import { equal, test } from '@yaks/testing'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import { resolve } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import type { Bundle } from '@yaks/graph'
import type { Io, View } from '@yaks/inspect'
import { asked, conversationViews } from './talk.ts'

let entry = (eid: string, seq: number, comps: Record<string, unknown>) => ({
  entity: { eid },
  entry: { session: 's1', seq },
  ...comps,
})
let entries: Bundle[] = [
  entry('a', 1, { content: { body: 'Find the map' } }),
  entry('c', 2, { call: { to: 'read', args: { path: 'map' } } }),
  entry('r', 3, { result: { call: 'c' }, content: { body: 'the map' } }),
  entry('o', 4, { output: {}, content: { body: 'Found **it**.' } }),
]
let session = { entity: { eid: 's1' }, session: {} }
let asks: string[] = []
let io = {
  ask: (a: Record<string, string>) => {
    asks.push(...Object.values(a))
    return { entries: { rows: entries, ready: true } }
  },
  state: () => undefined,
  set: () => {},
} as unknown as Io

let views = { renderers: conversationViews }
let view = resolve(views as never, session, 'Conversation', loadVocab([])) as
  | View
  | undefined
let html = renderToString(
  h(view!.Render, { e: session, io, got: {}, ctx: {} } as never),
)
let { document } = parseHTML(`<main>${html}</main>`)

test('a session draws as its conversation, from the entries it asks for', () => {
  equal(asks, [asked('s1')])
  equal(
    [...document.querySelectorAll('[id^=row-]')].map((r) => r.id),
    ['row-a', 'row-c', 'row-o'],
  )
  equal(document.querySelector('#row-o strong')?.textContent, 'it')
  equal(document.querySelector('#row-a')?.textContent, 'Find the map')
})
