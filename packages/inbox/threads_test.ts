import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Reader, type Row, threads } from './mod.ts'

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
let lanes = (all: Row[], reader: Reader = who) =>
  threads(all, reader).map((t) => [t.eid, t.lane, t.blocking])

let assigned = [
  row('decision', { task: {}, decision: {}, filed: { assignee: 'person' } }),
  row('ask', { task: {}, filed: { assignee: 'person' } }, 8),
  row('bug', { bug: { last: at(2) } }),
  row('worker', { task: {} }),
  row('edge', { requires: {}, edge: { from: 'worker', to: 'decision' } }),
]
test('threads rank outstanding assigned decisions and alerts ahead of eventual work', () => {
  let all = assigned
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
  let mark = row('attention', { archived: { at: at(5) } })
  let reader = { ...who, attention: new Map([['thread', mark]]) }
  assertEquals(threads(all, reader), [])
  all.push(comment('later', 'thread', 6, 'other', 'nested'))
  assertEquals(threads(all, reader).map((t) => t.eid), ['thread'])
  mark.comps.opened = { at: at(7), by: 'person' }
  all[0].comps.updated = { at: at(8) }
  mark.comps.archived = { at: at(6) }
  assertEquals(threads(all, reader), [])
  assertEquals(threads(all, reader, { all: true })[0].unread, false)
})

test('watched updates are state changes and landings, not progress chatter or edits', () => {
  let root = row('watched', { task: {}, updated: { at: at(8) } })
  let all = [root, comment('progress', 'watched', 2)]
  assertEquals(lanes(all), [])
  root.comps.blocked = { since: at(3), on: 'vendor' }
  assertEquals(lanes(all), [['watched', 'Updates', false]])
  let reader = {
    ...who,
    attention: new Map([[
      'watched',
      row('attention', { archived: { at: at(3) } }),
    ]]),
  }
  assertEquals(lanes(all, reader), [])
  all.push(
    row('landed', { commit: { target: 'watched', message: 'Ship it' } }, 4),
  )
  assertEquals(lanes(all, reader), [['watched', 'Updates', false]])
  assertEquals(threads(all, { ...reader, muting: new Set(['watched']) }), [])
})

test('search separates said from received and can find archived conversations', () => {
  let all = [
    row('thread', { task: {} }),
    comment('mine', 'thread', 2, 'person', undefined, 'Use SQLite'),
    comment('answer', 'thread', 3, 'agent', 'mine', 'Postgres works too'),
  ]
  let reader = {
    ...who,
    attention: new Map([[
      'thread',
      row('attention', { archived: { at: at(9) } }),
    ]]),
  }
  let find = (text: string, direction: 'said' | 'received') =>
    threads(all, reader, { text, direction, all: true }).map((t) => t.eid)
  assertEquals(find('sqlite', 'said'), ['thread'])
  assertEquals(find('sqlite', 'received'), [])
  assertEquals(find('POSTGRES', 'received'), ['thread'])
  assertEquals(threads(all, reader, { text: 'SQLite' }), [])
})

test('unread compares received activity with attention, and new alert occurrences resurface', () => {
  let all = [
    row('bug', {
      bug: { last: at(3) },
    }),
  ]
  let reader = {
    ...who,
    attention: new Map([[
      'bug',
      row('attention', {
        archived: { at: at(2) },
        opened: { at: at(3), by: 'person' },
      }),
    ]]),
  }
  assertEquals(threads(all, reader)[0].unread, false)
  all[0].comps.bug.last = at(4)
  assertEquals(threads(all, reader)[0].unread, true)
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

test('a thread opens with its root, beside a reply said in the same instant', () => {
  let letter = row('z-letter', { mail: {}, conversation: {} }, 1, 'stranger')
  let [thread] = threads(
    [letter, comment('a-reply', 'z-letter', 1, 'person')],
    who,
  )
  assertEquals(thread.messages.map((r) => r.eid), ['z-letter', 'a-reply'])
})

test('attention on a mail root reads or puts away the whole thread', () => {
  let letter = (eid: string, n: number, reply_to?: string) =>
    row(eid, {
      mail: {
        from: 'holdco@example.com',
        to: 'person@example.com',
        message_id: eid,
        reply_to,
      },
    }, n)
  let all = [letter('letter', 1), letter('answer', 3, 'letter')]
  let mark = row('attention')
  let reader = { ...who, attention: new Map([['letter', mark]]) }
  let seen = () => threads(all, reader).map((t) => [t.eid, t.unread])
  assertEquals(seen(), [['letter', true]])
  mark.comps.opened = { at: at(4), by: 'person' }
  assertEquals(seen(), [['letter', false]])
  mark.comps.archived = { at: at(4) }
  assertEquals(seen(), [])
  all.push(letter('more', 5, 'answer'))
  assertEquals(seen(), [['letter', true]])
})

test('archived entities do not demand attention as alerts or assigned work', () => {
  let roots = [
    row('old-bug', { bug: { last: at(9) }, archived: { at: at(2) } }),
    row('old-task', { task: {}, filed: { assignee: 'person' }, archived: {} }),
    row('old-decision', {
      decision: {},
      filed: { assignee: 'person' },
      archived: {},
    }),
  ]
  assertEquals(threads(roots, who), [])
  assertEquals(
    threads(roots, who, { all: true }).filter((t) => t.lane == 'Needs you'),
    [],
  )
  roots.push(comment('answer', 'old-task', 10, 'agent'))
  let addressed = { ...who, claims: new Set(['old-task']) }
  assertEquals(threads(roots, addressed).map((t) => [t.eid, t.lane]), [[
    'old-task',
    'Replies',
  ]])
})
