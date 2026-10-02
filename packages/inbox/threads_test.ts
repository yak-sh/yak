import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Row, threads } from './mod.ts'

let at = (n: number) => `2026-10-02T12:00:${String(n).padStart(2, '0')}.000Z`
let row = (
  eid: string,
  comps: Row['comps'] = {},
  n = 1,
  by = 'agent',
): Row => ({ eid, comps: { created: { at: at(n), by }, ...comps } })
let who = {
  actor: 'person',
  operator: true,
  addrs: new Set(['person', 'person@example.com']),
  watching: new Set(['watched']),
}
let comment = (
  eid: string,
  target: string,
  n: number,
  by = 'agent',
  reply_to?: string,
  body = eid,
) =>
  row(
    eid,
    { comment: { target, ...reply_to ? { reply_to } : {} }, doc: { body } },
    n,
    by,
  )
let lanes = (all: Row[]) =>
  threads(all, who).map((t) => [t.eid, t.lane, t.blocking])

test('threads rank outstanding assigned decisions and alerts ahead of eventual work', () => {
  let all = [
    row('decision', { task: {}, decision: {}, filed: { assignee: 'person' } }),
    row('ask', { task: {}, filed: { assignee: 'person' } }, 8),
    row('bug', { bug: { last: at(2) } }),
    row('worker', { task: {} }),
    row('edge', { requires: {}, edge: { from: 'worker', to: 'decision' } }),
  ]
  assertEquals(lanes(all), [['decision', 'Needs you', true], [
    'ask',
    'Needs you',
    false,
  ], ['bug', 'Needs you', false]])
  all[3].comps.completed = { at: at(9) }
  assertEquals(
    threads(all, who).find((t) => t.eid == 'decision')?.blocking,
    false,
  )
  all[0].comps.decided = { at: at(10), by: 'person', choice: 'yes' }
  assertEquals(
    threads(all, who).find((t) => t.eid == 'decision')?.lane,
    'Recent',
  )
})

test('replies follow your branch recursively and fold every message into one thread', () => {
  let all = [
    row('thread', { task: {} }),
    comment('mine', 'thread', 2, 'person'),
    comment('side', 'thread', 3),
    comment('answer', 'thread', 4, 'agent', 'mine'),
    comment('nested', 'thread', 5, 'other', 'answer'),
  ]
  assertEquals(lanes(all.slice(0, 3)), [['thread', 'Recent', false]])
  let [thread] = threads(all, who)
  assertEquals([thread.lane, thread.latest.eid, thread.messages.length], [
    'Replies',
    'nested',
    4,
  ])
  all[0].comps.archived = { at: at(5) }
  assertEquals(threads(all, who), [])
  all.push(comment('later', 'thread', 6, 'other', 'nested'))
  assertEquals(threads(all, who).map((t) => t.eid), ['thread'])
  all[0].comps.opened = { at: at(7), by: 'person' }
  all[0].comps.updated = { at: at(8) }
  all[0].comps.archived = { at: at(6) }
  assertEquals(threads(all, who), [])
  assertEquals(threads(all, who, { all: true })[0].unread, false)
})

test('watched updates are state changes and landings, not progress chatter or edits', () => {
  let root = row('watched', { task: {}, updated: { at: at(8) } })
  let all = [root, comment('progress', 'watched', 2)]
  assertEquals(lanes(all), [])
  root.comps.blocked = { since: at(3), on: 'vendor' }
  assertEquals(lanes(all), [['watched', 'Updates', false]])
  root.comps.archived = { at: at(3) }
  assertEquals(lanes(all), [])
  all.push(
    row('landed', { commit: { target: 'watched', message: 'Ship it' } }, 4),
  )
  assertEquals(lanes(all), [['watched', 'Updates', false]])
  assertEquals(threads(all, { ...who, muting: new Set(['watched']) }), [])
})

test('search separates said from received and can find archived conversations', () => {
  let all = [
    row('thread', { task: {}, archived: { at: at(9) } }),
    comment('mine', 'thread', 2, 'person', undefined, 'Use SQLite'),
    comment('answer', 'thread', 3, 'agent', 'mine', 'Postgres works too'),
  ]
  let find = (text: string, direction: 'said' | 'received') =>
    threads(all, who, { text, direction, all: true }).map((t) => t.eid)
  assertEquals(find('sqlite', 'said'), ['thread'])
  assertEquals(find('sqlite', 'received'), [])
  assertEquals(find('POSTGRES', 'received'), ['thread'])
  assertEquals(threads(all, who, { text: 'SQLite' }), [])
})

test('unread compares received activity with attention, and new alert occurrences resurface', () => {
  let all = [
    row('bug', {
      bug: { last: at(3) },
      archived: { at: at(2) },
      opened: { at: at(3), by: 'person' },
    }),
  ]
  assertEquals(threads(all, who)[0].unread, false)
  all[0].comps.bug.last = at(4)
  assertEquals(threads(all, who)[0].unread, true)
})

test('recent things you started are read, and your decision choice is said', () => {
  let root = row(
    'decision',
    { task: {}, decision: { question: 'Ship?' } },
    1,
    'person',
  )
  assertEquals(threads([root], who)[0].unread, false)
  root.comps.decided = { by: 'person', at: at(2), choice: 'Ship tomorrow' }
  assertEquals(
    threads([root], who, { direction: 'said', text: 'tomorrow' }).map((t) =>
      t.eid
    ),
    ['decision'],
  )
  assertEquals(
    threads([root], who, { direction: 'received', text: 'tomorrow' }),
    [],
  )
})

test('unassigned decisions reach the operator, while another person’s assigned ask does not', () => {
  let all = [
    row('default', { task: {}, decision: {} }),
    row('someone', { task: {}, decision: {}, filed: { assignee: 'other' } }),
  ]
  assertEquals(lanes(all), [['default', 'Needs you', false]])
})

test('decision search attributes questions and answers separately', () => {
  let root = row('decision', {
    task: {},
    decision: { question: 'Which database?' },
    doc: { title: 'Storage choice' },
    decided: { by: 'person', at: at(2), choice: 'SQLite' },
  })
  let find = (text: string, direction: 'said' | 'received') =>
    threads([root], who, { text, direction }).map((t) => t.eid)
  assertEquals(find('database', 'said'), [])
  assertEquals(find('sqlite', 'received'), [])
  assertEquals(find('sqlite', 'said'), ['decision'])
  assertEquals(find('database', 'received'), ['decision'])
  root.comps.created.by = 'person'
  root.comps.decided.by = 'agent'
  assertEquals(find('database', 'said'), ['decision'])
  assertEquals(find('sqlite', 'said'), [])
  assertEquals(find('sqlite', 'received'), ['decision'])
})
