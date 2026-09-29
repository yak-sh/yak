// A session row names the work and shows its latest activity and model.
import { test } from '@yaks/testing'
import { tick } from '../../testing.ts'
import { identityEid } from '@yaks/graph'
import { h, render } from 'preact'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import {
  cache,
  deps,
  ent,
  findEid,
  landSub,
  querySubscription,
  repoUrl,
  resetSignals,
  useRoute,
} from '../../live.ts'
import { parseQuery, resolveRefs } from '../../query.ts'
import { type Ent } from '../../types.ts'
import { resolve } from '../Entity.tsx'
import { mount } from '../mount.ts'
import {
  mentionSig,
  resolveMentions,
  Session,
  SessionContext,
  SessionDiagnostics,
  SessionEntry,
  sessionMentions,
  SessionReferences,
  SessionSummary,
  SessionTime,
  threadMentions,
} from './Session.tsx'

let entryPage = (eid: string, limit = 200) => {
  let q = `.entry.session=${eid}&.order=-entry.seq&.limit=${limit}`
  return querySubscription(resolveRefs(parseQuery(q), findEid), q)!.sub
}

test('session list Tile names its brief without exposing IDs', () => {
  cache.value = {
    actor: {
      entity: { eid: 'actor', num: 1 },
      doc: { eid: 'actor', title: 'Acme', body: '' },
      project: { eid: 'actor' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'session-id', actor: 'actor' },
      brief: { eid: 'session', text: 'Ship the update' },
    },
  }
  let e = ent('session')
  let mounted = mount(h(resolve(e, 'List.Tile').Render, { e }))
  try {
    assertEquals(
      mounted.root.querySelector('.SessionRow_Title')?.textContent,
      'Ship the update',
    )
    assertEquals(
      mounted.root.querySelector('.SessionRow_Id'),
      null,
    )
    assertEquals(mounted.root.querySelector('.Id'), null)
  } finally {
    mounted.free()
    cache.value = {}
  }
})

test('session row names the first ask and keeps the brief beneath it', async () => {
  let prior = useRoute(() => {})
  cache.value = {
    asking: {
      entity: { eid: 'asking', num: 2 },
      session: { eid: 'asking', id: 'opaque-run-id' },
      brief: { eid: 'asking', text: 'Found the cause' },
    },
    internal: {
      entity: { eid: 'internal', num: 3 },
      entry: { eid: 'internal', session: 'asking', seq: 1 },
      content: { eid: 'internal', body: 'Harness instructions' },
      prompt: { eid: 'internal' },
    },
    ask: {
      entity: { eid: 'ask', num: 4 },
      entry: { eid: 'ask', session: 'asking', seq: 2 },
      content: { eid: 'ask', body: 'Fix the tray\nplease' },
    },
  }
  let mounted = mount(h(resolve(ent('asking'), 'Tray.List.Tile').Render, {
    e: ent('asking'),
  }))
  try {
    await tick()
    assertEquals(
      mounted.root.querySelector('.SessionRow_Title')?.textContent,
      'Fix the tray please',
    )
    assertEquals(
      mounted.root.querySelector('.SessionRow_Brief')?.textContent,
      'Found the cause',
    )
  } finally {
    mounted.free()
    useRoute(prior)
    cache.value = {}
  }
})

test('session title names model and effort', () => {
  // A model's name is its identity: the eid is derived from it.
  let gpt = identityEid('model', ['gpt-5.6'])
  cache.value = {
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'session-id' },
      using: { eid: 'session', model: gpt, effort: 'high' },
    },
    [gpt]: {
      entity: { eid: gpt, num: 3 },
      model: { eid: gpt, name: 'gpt-5.6' },
    },
  }

  let e = ent('session')
  let { root, free } = mount(h(resolve(e, 'Card.Title').Render, { e }))
  assertEquals(
    root.querySelector('.CardTitle_Text')?.textContent,
    'GPT 5.6 · high',
  )
  free()
  cache.value = {}
})

test('uncached graph entries keep their normalized session face', () => {
  let { root, free } = mount(
    <SessionEntry
      x={{
        eid: 'entry',
        seq: 1,
        line: '{}',
        row: { kind: 'tool', name: 'Read', detail: 'src/query.ts' },
      }}
    />,
  )
  assertEquals(root.querySelector('.Entry_Name')?.textContent, 'Read')
  assertEquals(root.querySelector('.Json'), null)
  free()
})

test('session timestamps link to graph entries', () => {
  let eid = '12345678-0000-4000-8000-000000000001'
  cache.value = {
    [eid]: {
      entity: { eid, num: 0 },
      entry: { eid, session: 'session', seq: 1 },
    },
  }
  let x = {
    eid,
    seq: 1,
    line: '{}',
    row: {
      kind: 'say' as const,
      role: 'agent' as const,
      text: 'done',
      at: '2026-08-17T12:00:00Z',
    },
  }
  let shown = mount(
    <div>
      <SessionTime x={x} />
      <SessionTime x={{ ...x, eid: undefined }} />
    </div>,
  )
  try {
    let [linked, plain] = shown.root.querySelectorAll('.Session_When')
    assertEquals(linked.tagName, 'A')
    assertEquals(
      linked.getAttribute('href'),
      '/%231234567800',
    )
    assertEquals(plain.tagName, 'TIME')
    assertEquals(plain.getAttribute('href'), null)
  } finally {
    shown.free()
    cache.value = {}
  }
})

test('session context renders compactly for the sticky head', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(
      h(SessionContext, { tokens: 75009 }),
      root,
    )
    assertEquals(
      root.querySelector('.Session_Context')?.textContent,
      '75k context',
    )
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('session stderr is an error only for a non-zero exit', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(h(SessionDiagnostics, { stderr: 'noise', exit: 0 }), root)
    assertEquals(root.querySelector('.Session_Err-fail'), null)
    render(h(SessionDiagnostics, { stderr: 'broken', exit: 2 }), root)
    assertEquals(root.querySelector('.Session_Err-fail')?.textContent, 'broken')
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('session references dedupe entities and links in mention order', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 2 },
      doc: { eid: 'task', title: 'The task', body: '' },
      task: { eid: 'task', status: 'open' },
      filed: { eid: 'task', priority: 1 },
    },
  }
  assertEquals(
    sessionMentions([
      { row: { kind: 'say', role: 'user', text: 'T-2 https://x.test' } },
      {
        row: {
          kind: 'say',
          role: 'agent',
          text: '[same](T-2) then https://y.test',
        },
      },
      { row: { kind: 'exec', command: 'curl https://x.test' } },
    ]),
    [
      { kind: 'entity', id: 'T-2', eid: 'task' },
      { kind: 'link', href: 'https://x.test' },
      { kind: 'link', href: 'https://y.test' },
    ],
  )
  cache.value = {}
})

test('session references keep entity ids missing from the cache', () => {
  cache.value = {}
  assertEquals(
    sessionMentions([
      { row: { kind: 'say', role: 'agent', text: 'See T-17123' } },
    ]),
    [{ kind: 'entity', id: 'T-17123' }],
  )
})

test('graph-native session rows contribute references', () => {
  cache.value = {}
  assertEquals(
    sessionMentions([{
      eid: 'entry',
      seq: 1,
      line: '{}',
      row: { kind: 'say', role: 'agent', text: 'See T-42' },
    }]),
    [{ kind: 'entity', id: 'T-42' }],
  )
})

test('session references link commits with actor repository context', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      project: { eid: 'project' },
      repo: {
        eid: 'project',
        path: '/tmp/widget',
        url: 'https://github.com/acme/widget',
        base_branch: 'main',
      },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'run', actor: 'project' },
    },
  }
  assertEquals(
    sessionMentions([
      { row: { kind: 'say', role: 'agent', text: 'landed `c0b1ff1`' } },
    ], repoUrl(ent('session'))),
    [{
      kind: 'link',
      href: 'https://github.com/acme/widget/commit/c0b1ff1',
    }],
  )
  cache.value = {}
})

test('session references read conversation prose only', () => {
  assertEquals(
    sessionMentions([
      { row: { kind: 'reason', text: 'https://reason.test' } },
      {
        row: {
          kind: 'tool',
          name: 'fetch',
          detail: 'https://tool.test',
        },
      },
      {
        row: {
          kind: 'exec',
          command: 'curl https://exec.test',
          status: '0',
        },
      },
      { row: { kind: 'sys', tag: 'notice', text: 'https://sys.test' } },
      {
        row: {
          kind: 'say',
          role: 'agent',
          text: 'Read https://message.test',
        },
      },
    ]),
    [{ kind: 'link', href: 'https://message.test' }],
  )
})

test('session references use the usual entity and URL faces', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = {
    task: {
      entity: { eid: 'task', num: 2 },
      doc: { eid: 'task', title: 'The task', body: '' },
      task: { eid: 'task', status: 'open' },
      filed: { eid: 'task', priority: 1 },
    },
  }
  let root = document.querySelector('main')!
  try {
    render(
      h(SessionReferences, {
        items: [
          { kind: 'entity', id: 'T-2', eid: 'task' },
          { kind: 'entity', id: 'T-17123' },
          { kind: 'link', href: 'https://x.test' },
        ],
      }),
      root,
    )
    assertEquals(root.querySelector('details')?.hasAttribute('open'), true)
    assertEquals(
      root.querySelector('.Session_ReferencesGist')?.textContent,
      'references · 3',
    )
    assertEquals(root.querySelector('.Inline_Title')?.textContent, 'The task')
    let links = root.querySelectorAll('.Session_Reference > a')
    assertEquals(links[0]?.getAttribute('href'), '/T-2')
    assertEquals(links[1]?.getAttribute('href'), 'https://tasks.yak.sh/T-17123')
    assertEquals(links[1]?.getAttribute('data-ref'), 'T-17123')
    assertEquals(links[2]?.getAttribute('href'), 'https://x.test')
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

// The mention scan is memoized in the view on this signature — it must be STABLE
// when nothing feeding the parse changed (else the scan reruns every render, the
// regression) and CHANGE whenever it did (else a new/edited mention goes stale).
test('mentionSig: stable on unchanged content, shifts on every input', () => {
  let base = {
    count: 3,
    seq: 10,
    heard: [] as Ent[],
    repo: undefined as string | undefined,
  }
  let a = mentionSig(base)
  assertEquals(mentionSig({ ...base }), a) // unchanged → same key → no rescan
  assert(mentionSig({ ...base, seq: 11 }) != a, 'new log entry')
  assert(mentionSig({ ...base, count: 4 }) != a, 'entry count')
  assert(mentionSig({ ...base, repo: 'r' }) != a, 'repo scopes entity links')
  let c = {
    entity: { eid: 'c', num: 1 },
    doc: { eid: 'c', body: 'hi @T-1' },
    created: { eid: 'c', at: '2026-08-15T10:00:00Z' },
  } as unknown as Ent
  assert(mentionSig({ ...base, heard: [c] }) != a, 'a heard comment joins')
  let edited = {
    ...c,
    updated: { eid: 'c', at: '2026-08-15T11:00:00Z' },
  } as unknown as Ent
  assert(
    mentionSig({ ...base, heard: [c] }) !=
      mentionSig({ ...base, heard: [edited] }),
    'editing a heard comment bumps its updated.at',
  )
})

// The view splits the scan (threadMentions) from resolve+dedup (resolveMentions)
// to memoize the first alone — the split must stay behavior-identical to the
// composed sessionMentions.
test('sessionMentions == resolveMentions(threadMentions)', () => {
  let thread = [{
    row: {
      kind: 'say' as const,
      role: 'agent' as const,
      text: 'see T-1 and T-1',
    },
  }]
  assertEquals(sessionMentions(thread), resolveMentions(threadMentions(thread)))
})

test('SessionRow loads its task title when no peer delivered it', async () => {
  let { SessionRow } = await import('./Session.tsx')
  let { routeName, unsubscribe } = await import('../../live.ts')
  let { tick } = await import('../../testing.ts')
  let prior = useRoute(() => {})
  cache.value = {
    'task-row-session': {
      entity: { eid: 'task-row-session', num: 910 },
      session: { eid: 'task-row-session', id: 'native' },
    },
  }
  deps.value = [{
    parent: 'task-row-session',
    type: 'worked',
    child: 'cold-task',
  }]
  let sub = routeName('cold-task', 'doc.title,client.user_agent,session.id')
  let mounted = mount(<SessionRow e={ent('task-row-session')} />)
  try {
    assertEquals(
      mounted.root.querySelector('.SessionRow_Title')?.textContent,
      'Session',
    )
    landSub({
      sub,
      replace: true,
      fields: [{ comp: 'doc', prop: 'title', wake: true }],
      changes: [
        { eid: 'cold-task', name: 'entity', comp: { num: 911 } },
        {
          eid: 'cold-task',
          name: 'doc',
          comp: { title: 'Task outside the cache' },
        },
      ],
    })
    await tick()
    assertEquals(
      mounted.root.querySelector('.SessionRow_Title')?.textContent,
      'Task outside the cache',
    )
  } finally {
    mounted.free()
    unsubscribe(sub)
    useRoute(prior)
    cache.value = {}
    deps.value = []
  }
})

test('session Tile names its work, model, and last activity without IDs', () => {
  let prior = globalThis.fetch
  let fetched = 0
  globalThis.fetch = (() => {
    fetched++
    throw new Error('session Tile must not fetch')
  }) as typeof fetch
  let model = identityEid('model', ['gpt-5.6-sol'])
  let lastAt = '2026-08-15T11:00:00-04:00'
  cache.value = {
    persona: {
      entity: { eid: 'persona', num: 1 },
      doc: { eid: 'persona', title: 'Ada', body: '' },
      persona: { eid: 'persona' },
    },
    [model]: {
      entity: { eid: model, num: 5 },
      model: { eid: model, name: 'gpt-5.6-sol' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'session-id', actor: 'persona' },
      using: { eid: 'session', model, effort: 'high' },
      brief: { eid: 'session', text: 'Finished the first part' },
      created: { eid: 'session', at: '2026-08-15T09:00:00-04:00' },
    },
    'last-entry': {
      entity: { eid: 'last-entry', num: 6 },
      entry: { eid: 'last-entry', session: 'session', seq: 42 },
      created: { eid: 'last-entry', at: lastAt },
    },
    one: {
      entity: { eid: 'one', num: 3 },
      doc: { eid: 'one', title: 'First task', body: '' },
      task: { eid: 'one', status: 'done' },
      filed: { eid: 'one', priority: 1 },
    },
    two: {
      entity: { eid: 'two', num: 4 },
      doc: { eid: 'two', title: 'Second task', body: '' },
      task: { eid: 'two', status: 'wip' },
      filed: { eid: 'two', priority: 1 },
    },
  }
  deps.value = [
    { parent: 'session', type: 'worked', child: 'one' },
    { parent: 'session', type: 'worked', child: 'two' },
  ]

  let e = ent('session')
  let mounted = mount(h(resolve(e, 'Tray.List.Tile').Render, { e }))
  try {
    let { root } = mounted
    let head = root.querySelector('.SessionRow_Head')!
    assertEquals(
      [...head.children].map((x) => x.className.split(' ')[0]),
      [
        'Dot',
        'SessionRow_Title',
        'SessionRow_Meta',
      ],
    )
    assertEquals(head.querySelector('.Id'), null)
    assertEquals(head.querySelector('.SessionRow_Id'), null)
    assertEquals(root.textContent?.includes('session-id'), false)
    assertEquals(root.textContent?.includes('S-2'), false)
    assertEquals(
      head.querySelector('.SessionRow_Meta')?.textContent?.includes('#42'),
      true,
    )
    assertEquals(
      head.querySelector('.SessionRow_Meta')?.textContent?.includes(
        'gpt-5.6-sol',
      ),
      true,
    )
    assertEquals(
      head.querySelector('.SessionRow_Meta')?.textContent?.includes('active '),
      true,
    )
    assertEquals(
      head.querySelector('.SessionRow_Meta [data-tip]')?.getAttribute(
        'data-tip',
      ),
      new Date(lastAt).toLocaleString(),
    )
    assertEquals(
      head.querySelector('.SessionRow_Title')?.textContent,
      'Second task',
    )
    assertEquals(
      root.querySelector('.SessionRow_Brief')?.textContent,
      'Finished the first part',
    )
    assertEquals(fetched, 0)
  } finally {
    mounted.free()
    cache.value = {}
    deps.value = []
    globalThis.fetch = prior
  }
})

test('session lifecycle shares the task summary lane', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'The task', body: '' },
      task: { eid: 'task' },
      filed: { eid: 'task', priority: 1 },
      claim: { eid: 'task', session: 'session' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'session-id' },
    },
  }

  let root = document.querySelector('main')!
  try {
    render(
      h(SessionSummary, { e: ent('session'), gist: 'started 2m ago' }),
      root,
    )
    let summary = root.querySelector('.Session_Summary')!
    assertEquals(summary.querySelector('.Inline') != null, true)
    assertEquals(
      summary.querySelector('.Session_Facts')?.parentElement == summary,
      true,
    )
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('Session explains loading, ready-empty, rows, and read failure', async () => {
  let priorRoute = useRoute(() => {})
  let session = (
    eid: string,
    num: number,
    status: 'running' | 'settled',
  ) => {
    cache.value = {
      [eid]: {
        entity: { eid, num },
        session: { eid, id: eid, status },
      },
    }
    resetSignals()
    return ent(eid)
  }
  let state = (m: ReturnType<typeof mount>) =>
    m.root.querySelector('.Session_EntryState')?.textContent
  let mounted: ReturnType<typeof mount> | undefined
  try {
    let e = session('session-loading-copy', 7101, 'running')
    mounted = mount(<Session e={e} />)
    assertEquals(state(mounted), 'Loading entries for S-7101…')

    landSub({ sub: entryPage(e.eid), changes: [], replace: true })
    await Promise.resolve()
    assertEquals(state(mounted), 'No entries yet')

    // A person's input and the model's answer, as @yaks/session writes them.
    let line = (
      eid: string,
      seq: number,
      comps: [string, Record<string, unknown>][],
    ) => [
      { eid, name: 'entry', comp: { session: e.eid, seq } },
      ...comps.map(([name, comp]) => ({ eid, name, comp })),
    ]
    landSub({
      sub: entryPage(e.eid),
      replace: true,
      changes: [
        ...line('said', 1, [['content', { body: 'what a person said' }]]),
        ...line('answer', 2, [
          ['content', { body: 'what the model said' }],
          ['output', { source: 'ask' }],
        ]),
      ],
    })
    await Promise.resolve()
    assertEquals(state(mounted), undefined)
    let log = mounted.root.querySelector('.Session_Log')!
    assertEquals(
      log.querySelector('.Entry-user')?.textContent.trim(),
      'what a person said',
    )
    assertEquals(
      log.querySelector('.Entry-agent')?.textContent.trim(),
      'what the model said',
    )
    mounted.free()
    mounted = undefined

    e = session('session-ended-copy', 7103, 'settled')
    landSub({ sub: entryPage(e.eid), changes: [], replace: true })
    mounted = mount(<Session e={e} />)
    assertEquals(state(mounted), 'No entries recorded')
    mounted.free()
    mounted = undefined

    e = session('session-failed-copy', 7104, 'settled')
    landSub({
      sub: entryPage(e.eid),
      changes: [],
      replace: true,
      error: 'source unreadable',
    })
    mounted = mount(<Session e={e} />)
    assertEquals(
      state(mounted),
      `Entries could not be loaded: source unreadable [${
        entryPage(e.eid)
      }] retry`,
    )
  } finally {
    mounted?.free()
    useRoute(priorRoute)
    cache.value = {}
    resetSignals()
  }
})

test('Session paints the newest page and loads earlier entries on demand', async () => {
  let off = useRoute(() => {})
  let eid = 'long-session'
  cache.value = {
    [eid]: {
      entity: { eid, num: 7110 },
      session: { eid, id: eid, status: 'settled' },
    },
  }
  resetSignals()
  let mounted = mount(<Session e={ent(eid)} />)
  let change = (seq: number) => [
    { eid: `entry-${seq}`, name: 'entry', comp: { session: eid, seq } },
    { eid: `entry-${seq}`, name: 'content', comp: { body: `line ${seq}` } },
    { eid: `entry-${seq}`, name: 'output', comp: { source: 'ask' } },
  ]
  let lines = () =>
    [...mounted.root.querySelectorAll('.Entry-agent')].map(
      (x) => x.textContent.trim(),
    )
  try {
    landSub({
      sub: entryPage(eid),
      replace: true,
      changes: Array.from({ length: 200 }, (_, n) => n + 2).flatMap(change),
    })
    await tick()
    assertEquals(lines().includes('line 201'), true)
    assertEquals(lines().includes('line 1'), false)
    let earlier = mounted.root.querySelector('.Session_Earlier') as HTMLElement
    assertEquals(earlier?.textContent, '↑ Earlier entries')
    earlier.click()
    await tick()
    assertEquals(
      mounted.root.querySelector('.Session_Earlier')?.textContent,
      'Loading earlier entries…',
    )

    landSub({
      sub: entryPage(eid, 400),
      replace: true,
      changes: Array.from({ length: 201 }, (_, n) => n + 1).flatMap(change),
    })
    await tick()
    assertEquals(lines().includes('line 1'), true)
    assertEquals(lines().includes('line 201'), true)
    assertEquals(mounted.root.querySelector('.Session_Earlier'), null)
  } finally {
    mounted.free()
    useRoute(off)
    cache.value = {}
    resetSignals()
  }
})
