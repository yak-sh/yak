// A session row keeps the actor it works for visible in every shared list.
import { h, render } from 'preact'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, deps, ent, repoUrl } from '../../live.ts'
import { type Ent } from '../../types.ts'
import { resolve } from '../Entity.tsx'
import { mount } from '../mount.ts'
import {
  doing,
  mentionSig,
  observing,
  resolveMentions,
  SessionContext,
  SessionDiagnostics,
  SessionEntry,
  sessionMentions,
  SessionObservation,
  SessionReferences,
  SessionSummary,
  threadMentions,
} from './Session.tsx'

Deno.test('session activity explains transcript and transient waits', () => {
  assertEquals(doing(undefined, undefined, true), 'starting…')
  assertEquals(
    doing({ kind: 'say', role: 'agent', text: 'done' }, 'idle'),
    'waiting for request…',
  )
  assertEquals(
    doing({ kind: 'exec', command: 'deno task test' }),
    'running command…',
  )
  assertEquals(
    observing({
      generation: 'g',
      model: 'old model text',
      reasoning: '',
      tools: ['old_tool'],
      items: [{ kind: 'reasoning', text: 'new thought' }],
      rev: 3,
    }),
    'thinking…',
  )
})

Deno.test('session Tile omits its chip and lists every worked task', () => {
  let prior = globalThis.fetch
  let fetched = 0
  globalThis.fetch = (() => {
    fetched++
    throw new Error('session Tile must not fetch')
  }) as typeof fetch
  cache.value = {
    persona: {
      entity: { eid: 'persona', num: 1 },
      doc: { eid: 'persona', title: 'Ada', body: '' },
      persona: { eid: 'persona' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: {
        eid: 'session',
        id: 'session-id',
        model: 'gpt-5.6-sol',
        effort: 'high',
        persona: 'persona',
      },
      created: { eid: 'session', at: '2026-08-15T09:00:00-04:00' },
    },
    one: {
      entity: { eid: 'one', num: 3 },
      doc: { eid: 'one', title: 'First task', body: '' },
      task: { eid: 'one', status: 'done', priority: 1 },
    },
    two: {
      entity: { eid: 'two', num: 4 },
      doc: { eid: 'two', title: 'Second task', body: '' },
      task: { eid: 'two', status: 'wip', priority: 1 },
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
        'SessionRow_Identity',
        'SessionRow_Model',
        'SessionRow_Effort',
        'Stamp',
      ],
    )
    assertEquals(head.querySelector('.Id'), null)
    assertEquals(
      head.querySelector('.SessionRow_Identity')?.textContent,
      'Ada',
    )
    assertEquals(
      head.querySelector('.SessionRow_Model')?.textContent,
      'GPT 5.6 Sol',
    )
    assertEquals(
      head.querySelector('.SessionRow_Effort')?.textContent,
      'high',
    )
    assertEquals(
      [...root.querySelectorAll('.SessionRow_Task')].map((x) =>
        x.textContent.replace(/\s+/g, ' ').trim()
      ).sort(),
      ['First task', 'Second task'],
    )
    assertEquals(fetched, 0)
  } finally {
    mounted.free()
    cache.value = {}
    deps.value = []
    globalThis.fetch = prior
  }
})

Deno.test('session list Tile omits its chip and falls back to its actor', () => {
  cache.value = {
    actor: {
      entity: { eid: 'actor', num: 1 },
      doc: { eid: 'actor', title: 'Acme', body: '' },
      project: { eid: 'actor' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: { eid: 'session', id: 'session-id', actor: 'actor' },
    },
  }
  let e = ent('session')
  let mounted = mount(h(resolve(e, 'List.Tile').Render, { e }))
  try {
    assertEquals(
      mounted.root.querySelector('.SessionRow_Identity')?.textContent,
      'Acme',
    )
    assertEquals(mounted.root.querySelector('.Id'), null)
  } finally {
    mounted.free()
    cache.value = {}
  }
})

Deno.test('session title names model and effort', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 2 },
      session: {
        eid: 'session',
        id: 'session-id',
        model: 'gpt-5.6',
        effort: 'high',
      },
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

Deno.test('uncached graph entries keep their normalized session face', () => {
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

Deno.test('session context renders compactly for the sticky head', () => {
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

Deno.test('session stderr is an error only for a non-zero exit', () => {
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

Deno.test('session references dedupe entities and links in mention order', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 2 },
      doc: { eid: 'task', title: 'The task', body: '' },
      task: { eid: 'task', status: 'open', priority: 1 },
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

Deno.test('session references keep entity ids missing from the cache', () => {
  cache.value = {}
  assertEquals(
    sessionMentions([
      { row: { kind: 'say', role: 'agent', text: 'See T-17123' } },
    ]),
    [{ kind: 'entity', id: 'T-17123' }],
  )
})

Deno.test('graph-native session rows contribute references', () => {
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

Deno.test('session references link commits with actor repository context', () => {
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
      session: {
        eid: 'session',
        id: 'run',
        requested_task: 'missing',
        actor: 'project',
      },
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

Deno.test('session references read conversation prose only', () => {
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

Deno.test('session references use the usual entity and URL faces', () => {
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
      task: { eid: 'task', status: 'open', priority: 1 },
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

Deno.test('transient Session model progress renders through safe Markdown', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(
      h(SessionObservation, {
        state: {
          generation: 'generation',
          model: '**answer** <b>raw</b>',
          reasoning: '[reason](javascript:alert(1))',
          tools: ['shell'],
          items: [
            { kind: 'model', text: '**answer** <b>raw</b>' },
            { kind: 'reasoning', text: '[reason](javascript:alert(1))' },
            { kind: 'tool', name: 'shell' },
          ],
          rev: 3,
        },
      }),
      root,
    )
    assertEquals(
      root.querySelector('.Entry-agent')?.textContent.trim(),
      'answer <b>raw</b>',
    )
    assertEquals(
      root.querySelector('.Entry_Reason')?.textContent,
      '[reason](javascript:alert(1))',
    )
    assertEquals(root.querySelector('a'), null)
    assertEquals(root.querySelector('b'), null)
    assertEquals(root.querySelector('.Entry_Name')?.textContent, 'shell')
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('session lifecycle shares the task summary lane', () => {
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
      task: { eid: 'task', status: 'wip', priority: 1 },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: {
        eid: 'session',
        id: 'session-id',
        requested_task: 'task',
      },
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

// The mention scan is memoized in the view on this signature — it must be STABLE
// when nothing feeding the parse changed (else the scan reruns every render, the
// regression) and CHANGE whenever it did (else a new/edited mention goes stale).
Deno.test('mentionSig: stable on unchanged content, shifts on every input', () => {
  let base = {
    count: 3,
    seq: 10,
    rev: 0,
    said: false,
    final: '',
    heard: [] as Ent[],
    repo: undefined as string | undefined,
  }
  let a = mentionSig(base)
  assertEquals(mentionSig({ ...base }), a) // unchanged → same key → no rescan
  assert(mentionSig({ ...base, seq: 11 }) != a, 'new log entry')
  assert(mentionSig({ ...base, count: 4 }) != a, 'entry count')
  assert(mentionSig({ ...base, rev: 1 }) != a, 'streaming growth of last entry')
  assert(
    mentionSig({ ...base, said: true }) != a,
    'said flips the final prepend',
  )
  assert(mentionSig({ ...base, final: 'done T-9' }) != a, 'final_text')
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
Deno.test('sessionMentions == resolveMentions(threadMentions)', () => {
  let thread = [{
    row: {
      kind: 'say' as const,
      role: 'agent' as const,
      text: 'see T-1 and T-1',
    },
  }]
  assertEquals(sessionMentions(thread), resolveMentions(threadMentions(thread)))
})
