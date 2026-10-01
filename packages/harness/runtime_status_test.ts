import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { resolve } from '@yaks/render'
import { loadVocab, pick } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import doc from './runtime/vocab.json' with { type: 'json' }
import { runtimeRow, runtimeViews } from './RuntimePanel.ts'

let vocabulary = loadVocab([
  doc,
  pick(sessionDoc, ['dispatch']),
  pick(kernelDoc, ['admitted', 'waiting']),
])
type Node = { props: Record<string, unknown> | null; children: unknown[] }

let status = (bundle: Bundle) => {
  let row = runtimeRow(bundle)
  let renderer = resolve(runtimeViews, row, 'Runtime', vocabulary)!
  let node = renderer.render<Node>(
    row,
    (_tag, props, ...children) => ({ props, children }),
    {},
  )
  return [
    (row.dispatch as Comp | undefined)?.status ?? null,
    node.children[0],
    node.props?.class,
  ]
}

test('runtime labels prefer legacy dispatch state over stale ladder marks', () => {
  let cases: [string, Partial<Bundle>, string | null, string, string][] = [
    [
      'queued with waiting',
      {
        dispatch: { state: 'queued', status: 'waiting' },
        waiting: {},
      },
      'queued',
      'queued',
      'Key',
    ],
    [
      'queued with admitted and waiting',
      {
        dispatch: { state: 'queued', status: 'active' },
        admitted: {},
        waiting: {},
        attempt: { state: 'inflight' },
      },
      'queued',
      'queued',
      'Key',
    ],
    [
      'active with waiting',
      {
        dispatch: { state: 'active', status: 'queued' },
        waiting: {},
      },
      'active',
      'running',
      'Key',
    ],
    [
      'active with admitted and waiting',
      {
        dispatch: { state: 'active', status: 'waiting' },
        admitted: {},
        waiting: {},
        call: { to: 'tool' },
      },
      'active',
      'waiting for tool',
      'Key',
    ],
    [
      'waiting with admitted',
      {
        dispatch: { state: 'waiting', status: 'queued' },
        admitted: {},
      },
      'waiting',
      'running',
      'Key',
    ],
  ]
  for (let [name, fields, dispatch, label, color] of cases) {
    let bundle: Bundle = {
      entity: { eid: name },
      session: { status: 'running' },
      ...fields,
    }
    let before = structuredClone(bundle)
    assertEquals(status(bundle), [dispatch, label, color], name)
    assertEquals(bundle, before, 'rendering must not change ' + name)
  }
})

test('runtime labels derive canonical dispatch admission before execution fallback', () => {
  let cases: [string, Partial<Bundle>, string | null, string, string][] = [
    ['unadmitted', { dispatch: {} }, 'queued', 'queued', 'Key'],
    [
      'unadmitted with stale status',
      {
        dispatch: { status: 'active' },
        attempt: { state: 'inflight' },
      },
      'queued',
      'queued',
      'Key',
    ],
    [
      'admitted with stale queued status',
      {
        dispatch: { status: 'queued' },
        admitted: {},
      },
      'active',
      'running',
      'Key',
    ],
    [
      'waiting with stale queued status',
      {
        dispatch: { status: 'queued' },
        waiting: {},
        call: { to: 'tool' },
      },
      'waiting',
      'waiting for tool',
      'Key',
    ],
    [
      'waiting and admitted',
      {
        dispatch: {},
        admitted: {},
        waiting: {},
        attempt: { state: 'inflight' },
      },
      'waiting',
      'generating',
      'Key',
    ],
    ['no dispatch', {}, null, 'running', 'Key'],
    [
      'no dispatch with unrelated marks',
      {
        admitted: {},
        waiting: {},
      },
      null,
      'running',
      'Key',
    ],
    [
      'no dispatch with tool',
      { call: { to: 'tool' } },
      null,
      'waiting for tool',
      'Key',
    ],
    [
      'no dispatch generating',
      { attempt: { state: 'inflight' } },
      null,
      'generating',
      'Key',
    ],
    [
      'no dispatch interrupted',
      { error: { code: 'interrupted' } },
      null,
      'interrupted',
      'Muted',
    ],
    ['pending', { session: { status: 'pending' } }, null, 'pending', 'Key'],
    ['failed', { session: { status: 'failed' } }, null, 'failed', 'Bad'],
    ['stopped', { session: { status: 'stopped' } }, null, 'stopped', 'Muted'],
    ['settled', { session: { status: 'settled' } }, null, 'idle', 'Good'],
  ]
  for (let [name, fields, dispatch, label, color] of cases) {
    let bundle: Bundle = {
      entity: { eid: name },
      session: { status: 'running' },
      ...fields,
    }
    let before = structuredClone(bundle)
    assertEquals(status(bundle), [dispatch, label, color], name)
    assertEquals(bundle, before, 'rendering must not change ' + name)
  }
})
