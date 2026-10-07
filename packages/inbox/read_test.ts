import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Bundle, type Comp, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { render } from '@yaks/sql'
import { readerAt, type Row } from './reader.ts'
import { type Search, type Thread, threads } from './threads.ts'
import { readInbox, readThread } from './read.ts'

let defs: Record<string, string[]> = {
  entity: ['eid', 'archetype'],
  email: ['address'],
  subscription: ['actor', 'target', 'mode'],
  doc: ['title', 'body'],
  conversation: [],
  content: ['body'],
  comment: ['target', 'reply_to'],
  entry: ['session', 'seq'],
  output: [],
  notice: [],
  reasoning: [],
  result: [],
  exception: [],
  refusal: [],
  ask: [],
  call: [],
  stop: [],
  prompt: [],
  commit: ['target', 'at', 'message'],
  session: ['actor'],
  project: [],
  design: [],
  task: [],
  decision: ['question'],
  filed: ['assignee', 'project'],
  mail: ['at', 'from', 'to', 'target', 'message_id', 'reply_to'],
  mail_notice: [],
  notified: ['message_id'],
  knock: ['target'],
  deliver: ['to'],
  signal: ['target'],
  bug: ['title', 'app', 'first', 'last'],
  created: ['by', 'at'],
  opened: ['by', 'at'],
  archived: ['at'],
  completed: ['at'],
  cancelled: ['at'],
  failed: ['at'],
  blocked: ['since'],
  broken: ['at'],
  resolved: ['at'],
  regressed: ['at'],
  decided: ['at', 'by', 'choice'],
  exit: ['at'],
  requires: [],
  edge: ['from', 'to'],
}
let vocab = loadVocab([{
  $defs: Object.fromEntries(
    Object.entries(defs).map(([name, props]) => [name, {
      component: true,
      type: 'object',
      properties: Object.fromEntries(props.map((prop) => [prop, {
        type: prop == 'seq' ? 'number' : 'string',
        ...(prop == 'archetype' ? { ref: 'archetype' } : {}),
      }])),
    }]),
  ),
}, archetypeDoc])
let at = (n: number) => `2026-10-02T12:${String(n).padStart(2, '0')}:00.000Z`
let row = (
  eid: string,
  comps: Row['comps'] = {},
  n = 1,
  by = 'agent',
): Bundle => ({ entity: { eid }, created: { at: at(n), by }, ...comps })
let asRows = (all: Bundle[]): Row[] =>
  all.map((b) => ({
    eid: b.entity.eid,
    comps: Object.fromEntries(
      Object.entries(b).filter(([name]) => name != 'entity'),
    ) as Row['comps'],
  }))
let policy = (all: Thread[]) =>
  all.map((t) => ({
    eid: t.eid,
    lane: t.lane,
    reason: t.reason,
    blocking: t.blocking,
    at: t.at,
    unread: t.unread,
    root: t.row.eid,
    latest: t.latest.eid,
    messages: t.messages.map((m) => m.eid),
  }))
let fixture = (): Bundle[] => [
  row('person', { email: { address: 'person@example.com' } }, 1, 'person'),
  row('watch', {
    subscription: { actor: 'person', target: 'watched', mode: 'watch' },
  }),
  row('mute', {
    subscription: { actor: 'person', target: 'muted', mode: 'mute' },
  }),
  row(
    'thread',
    { conversation: {}, doc: { body: 'start SQLite' } },
    1,
    'person',
  ),
  row(
    'mine',
    { comment: { target: 'thread' }, doc: { body: 'Use SQLite' } },
    2,
    'person',
  ),
  row('side', { comment: { target: 'thread' }, doc: { body: 'Unrelated' } }, 3),
  row('answer', {
    comment: { target: 'thread', reply_to: 'mine' },
    doc: { body: 'Postgres too' },
  }, 4),
  row('nested', {
    comment: { target: 'thread', reply_to: 'answer' },
    doc: { body: 'Nested' },
  }, 5),
  row('decision', {
    task: {},
    decision: { question: 'Which database?' },
    filed: { assignee: 'person' },
  }),
  row('worker', { task: {} }),
  row('edge', { requires: {}, edge: { from: 'worker', to: 'decision' } }),
  row('closed-worker', { task: {}, cancelled: {} }),
  row('closed-edge', {
    requires: {},
    edge: { from: 'closed-worker', to: 'decision' },
  }),
  row('chosen', {
    task: {},
    decision: { question: 'Choose storage' },
    decided: { by: 'person', at: at(3), choice: 'SQLite' },
  }),
  row('eventual', { task: {}, decision: {}, filed: { assignee: 'other' } }),
  row('watched', {
    task: {},
    blocked: { since: at(2) },
    opened: { by: 'person', at: at(3) },
  }),
  row(
    'landing',
    { commit: { target: 'watched', at: at(4), message: 'Ship' } },
    4,
  ),
  row('muted', { task: {}, filed: { assignee: 'person' } }),
  row('archived', { conversation: {}, archived: { at: at(8) } }, 1, 'person'),
  row('archived-answer', {
    comment: { target: 'archived' },
    doc: { body: 'old words' },
  }, 7),
  row('empty-archive', { task: {}, archived: {} }, 1, 'person'),
  row('completed', { task: {}, filed: { assignee: 'person' }, completed: {} }),
  row('bug', { bug: { last: at(6) } }),
  row('session', { session: { actor: 'person' }, doc: {} }),
  row(
    'input',
    { entry: { session: 'session', seq: 1 }, content: { body: 'human words' } },
    2,
    'agent',
  ),
  row('output', {
    entry: { session: 'session', seq: 2 },
    output: {},
    content: { body: 'visible answer' },
  }, 3),
  row('reasoning', {
    entry: { session: 'session', seq: 3 },
    output: {},
    reasoning: {},
    content: { body: 'internal needle' },
  }, 4),
  row('call', {
    entry: { session: 'session', seq: 4 },
    call: {},
    content: { body: 'internal tool needle' },
  }, 5),
  row('prompt', {
    entry: { session: 'session', seq: 5 },
    prompt: {},
    content: { body: 'prompt needle' },
  }, 6),
  row('passive', {
    entry: { session: 'session', seq: 6 },
    notice: {},
    content: { body: 'passive needle' },
  }, 7),
  row('attempt', { entry: { session: 'session', seq: 7 }, ask: {} }, 8),
  row('failure', {
    entry: { session: 'session', seq: 8 },
    exception: {},
    content: { body: 'failure' },
  }, 9),
  row('stop', { entry: { session: 'session', seq: 9 }, stop: {} }, 10),
  row('mail-root', {
    mail: {
      from: 'person@example.com',
      to: 'agent@example.com',
      message_id: '<root>',
    },
    doc: { body: 'mail start' },
  }, 2),
  row('mail-middle', {
    mail: {
      from: 'other@example.com',
      reply_to: '<root>',
      message_id: '<middle>',
    },
    doc: { body: 'middle' },
  }, 3),
  row('mail-reply', {
    mail: {
      from: 'other@example.com',
      to: 'person@example.com',
      reply_to: '<middle>',
      message_id: '<reply>',
    },
    doc: { body: 'received mail' },
  }, 4),
  row('digest', {
    mail_notice: {},
    mail: { to: 'person@example.com', message_id: '<digest>' },
    doc: { body: 'digest' },
  }, 5),
]

// Patch fixture facts through storage so server-owned timestamps/authors are
// exactly the facts the reference policy sees (not discarded by admission).
let setup = async (kind: 'ram' | 'sqlite', all: Bundle[]) => {
  let driver = kind == 'sqlite' ? open(':memory:') : undefined
  let sql: string[] = []
  if (driver) {
    let query = driver.query.bind(driver)
    driver.query = (statement) => {
      sql.push(render(statement).sql)
      return query(statement)
    }
  }
  let store = driver ? storage(driver, vocab) : ram(vocab)
  await store.install()
  await store.tx((tx) => tx.patch(all))
  let g = graph({ vocab, storage: store })
  // RAM's raw storage matcher does not project; Graph is its public read door.
  let tx: Pick<Graph, 'read' | 'get'> = {
    read: (q, opts) => g.read(q, opts),
    get: (ids, comps) => g.get(ids, comps),
  }
  return { tx, store, sql, close: () => driver?.close() }
}

for (let kind of ['ram', 'sqlite'] as const) {
  test(`${kind}: metadata/search/detail match full inbox policy`, async () => {
    let { tx, close } = await setup(kind, fixture())
    try {
      let all = asRows(await tx.get(fixture().map((b) => b.entity.eid)))
      let who = readerAt(all, 'person')
      let searches: Search[] = [
        {},
        { all: true },
        { lane: 'Needs you' },
        { text: 'SQLite', all: true },
        { direction: 'said', text: 'SQLite', all: true },
        { direction: 'received', text: 'SQLite', all: true },
        { direction: 'received' },
        { text: 'internal needle' },
        { text: 'prompt needle' },
        { text: 'passive needle' },
      ]
      for (let search of searches) {
        assertEquals(
          policy(await readInbox(tx, vocab, 'person', search)),
          policy(threads(all, who, search)),
        )
      }
      let metadata = await readInbox(tx, vocab, 'person', { all: true })
      for (let t of metadata) {
        for (let r of [t.row, t.latest, ...t.messages]) {
          assertEquals(r.comps.doc?.body, undefined)
          assertEquals(r.comps.content?.body, undefined)
        }
      }
      for (let expected of threads(all, who, { all: true })) {
        let detail = await readThread(tx, vocab, 'person', expected.eid)
        assert(detail)
        assertEquals(policy([detail]), policy([expected]))
        assertEquals(
          detail.row.comps.doc?.body ?? undefined,
          expected.row.comps.doc?.body ?? undefined,
        )
        assertEquals(
          detail.messages.map((m) =>
            m.comps.doc?.body ?? m.comps.content?.body ?? undefined
          ),
          expected.messages.map((m) =>
            m.comps.doc?.body ?? m.comps.content?.body ?? undefined
          ),
        )
      }
      assertEquals(await readThread(tx, vocab, 'person', 'missing'), undefined)
      assertEquals(await readThread(tx, vocab, 'person', 'muted'), undefined)
    } finally {
      close()
    }
  })
}

test('default metadata never accesses enormous body values; search reads complete internal words', async () => {
  let all = fixture()
  let { tx, store, close } = await setup('ram', all)
  let accesses = 0
  let body = 'x'.repeat(2_000_000) + ' internal-final-needle'
  let internal = (await store.get(['reasoning']))[0].content as Comp
  Object.defineProperty(internal, 'body', {
    enumerable: true,
    configurable: true,
    get: () => {
      accesses++
      return body
    },
  })
  let human = (await store.get(['input']))[0].content as Comp
  Object.defineProperty(human, 'body', {
    enumerable: true,
    configurable: true,
    get: () => {
      accesses++
      return body
    },
  })
  try {
    let inbox = await readInbox(tx, vocab, 'person')
    assertEquals(accesses, 0)
    let session = inbox.find((t) => t.eid == 'session')!
    assertEquals(session.messages.map((m) => m.eid), ['input', 'output'])
    assertEquals(session.messages[0].comps.content, {})
    assertEquals(
      (await readInbox(tx, vocab, 'person', {
        text: 'internal-final-needle',
        direction: 'received',
      })).map((t) => t.eid),
      ['session'],
    )
    assert(accesses > 0)
    let detail = await readThread(tx, vocab, 'person', 'session')
    assertEquals(detail?.messages[0].comps.content.body, body)
  } finally {
    close()
  }
})

test('classified metadata uses descriptor presence, not one query per component', async () => {
  let { tx, close } = await setup('sqlite', fixture())
  let queries: string[] = [], descriptors = 0
  let counted: Pick<Graph, 'read' | 'get'> = {
    read: (q, opts) => {
      queries.push(String(q))
      return tx.read(q, opts)
    },
    get: (ids, comps) => {
      if (comps?.includes('archetype')) descriptors += ids.length
      return tx.get(ids, comps)
    },
  }
  try {
    assert((await readInbox(counted, vocab, 'person')).length > 0)
    assert(descriptors > 0)
    assertEquals(
      queries.filter((q) => /^\.content&|^\.output&|^\.doc&/.test(q)),
      [],
    )
  } finally {
    close()
  }
})

test('overlapping discussion batches deduplicate messages and retain blockers', async () => {
  let all: Bundle[] = [row('person'), row('worker', { task: {} })]
  for (let i = 0; i < 300; i++) {
    all.push(row(`root${i}`, { task: {}, filed: { assignee: 'person' } }))
    all.push(row(`own${i}`, { comment: { target: `root${i}` } }, 2, 'person'))
    all.push(
      row(`answer${i}`, {
        comment: { target: `root${i}`, reply_to: `own${i}` },
      }, 3),
    )
    all.push(
      row(`edge${i}`, {
        requires: {},
        edge: { from: 'worker', to: `root${i}` },
      }),
    )
  }
  let { tx, close } = await setup('sqlite', all)
  try {
    let actual = await readInbox(tx, vocab, 'person')

    let full = asRows(await tx.get(all.map((b) => b.entity.eid)))
    assertEquals(
      policy(actual),
      policy(threads(full, readerAt(full, 'person'))),
    )
    assertEquals(actual.length, 300)
    assert(actual.every((t) => t.blocking && t.messages.length == 2))
  } finally {
    close()
  }
})

test('SQLite default projections never select doc/content body columns', async () => {
  let { tx, sql, close } = await setup('sqlite', fixture())
  try {
    sql.length = 0
    await readInbox(tx, vocab, 'person')
    assert(sql.length > 0)
    assertEquals(sql.filter((q) => /\"body\"/.test(q)), [])
  } finally {
    close()
  }
})

test('sparse vocabulary preserves empty doc and archive marks without unknown queries', async () => {
  let sparse = loadVocab({
    $defs: Object.fromEntries([
      ['doc', ['body']],
      ['created', ['by', 'at']],
      ['opened', ['by']],
      ['archived', []],
      ['comment', ['target', 'reply_to']],
    ].map(([name, props]) => [name as string, {
      component: true,
      type: 'object',
      properties: Object.fromEntries(
        (props as string[]).map((p) => [p, { type: 'string' }]),
      ),
    }])),
  })
  let store = ram(sparse)
  let all = [
    row('root', { doc: {}, archived: {} }, 1, 'person'),
    row('answer', {
      comment: { target: 'root' },
      doc: { body: 'complete words' },
    }, 2),
  ]
  await store.tx((tx) => tx.patch(all))
  let g = graph({ vocab: sparse, storage: store })
  assertEquals(await readInbox(g, sparse, 'person'), [])
  let found = await readInbox(g, sparse, 'person', { all: true })
  assertEquals(
    policy(found),
    policy(
      threads(asRows(all), readerAt(asRows(all), 'person'), { all: true }),
    ),
  )
  assertEquals(found[0].row.comps.doc, {})
  assertEquals(found[0].row.comps.archived, {})
})

test('metadata projection carries classified spines without a duplicate identity read', async () => {
  let { tx, close } = await setup('sqlite', fixture())
  let identity = 0
  let counted: Pick<Graph, 'read' | 'get'> = {
    read: (q, opts) => tx.read(q, opts),
    get: (ids, comps) => {
      if (comps?.length === 0) identity++
      return tx.get(ids, comps)
    },
  }
  try {
    assert((await readInbox(counted, vocab, 'person')).length > 0)
    assertEquals(identity, 0)
  } finally {
    close()
  }
})
