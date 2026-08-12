// A session row keeps the actor it works for visible in every shared list.
import { h, render, type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import {
  SessionBody,
  SessionContext,
  sessionMentions,
  SessionObservation,
  SessionReferences,
  SessionSummary,
} from './Session.tsx'

let children = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat()
    .filter(Boolean) as VNode[]

Deno.test('session row names its actor', () => {
  cache.value = {
    project: {
      entity: { eid: 'project', num: 1 },
      doc: { eid: 'project', title: 'Task Graph', body: '' },
      project: { eid: 'project' },
    },
    session: {
      entity: { eid: 'session', num: 2 },
      session: {
        eid: 'session',
        id: 'session-id',
        actor: 'project',
        model: 'gpt-5.6',
      },
    },
  }

  let e = ent('session')
  let row = resolve(e, 'List.Tile').Render({ e })!
  let actor = children(row)[2]
  assertEquals(actor.props.children, 'Task Graph')
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
  let title = resolve(e, 'Card.Title').Render({ e })!
  let text = children(title)[2]
  assertEquals(text.props.children, ['GPT 5.6', ' · high'])
})

Deno.test('session user messages render as markdown', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  try {
    render(
      h(SessionBody, {
        x: {
          seq: 1,
          line: '',
          row: { kind: 'say', role: 'user', text: '**hello**' },
        },
      }),
      root,
    )
    assertEquals(
      root.innerHTML,
      '<div class="Session_User"><p><strong>hello</strong></p>\n</div>',
    )
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
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
      { row: { kind: 'reason', text: '[same](T-2) then https://y.test' } },
      { row: { kind: 'exec', command: 'curl https://x.test' } },
    ]),
    [
      { kind: 'entity', eid: 'task' },
      { kind: 'link', href: 'https://x.test' },
      { kind: 'link', href: 'https://y.test' },
    ],
  )
  cache.value = {}
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
          { kind: 'entity', eid: 'task' },
          { kind: 'link', href: 'https://x.test' },
        ],
      }),
      root,
    )
    assertEquals(root.querySelector('details')?.hasAttribute('open'), true)
    assertEquals(
      root.querySelector('.Session_ReferencesGist')?.textContent,
      'references · 2',
    )
    assertEquals(root.querySelector('.Inline_Title')?.textContent, 'The task')
    let links = root.querySelectorAll('.Session_Reference > a')
    assertEquals(links[0]?.getAttribute('href'), '/T-2')
    assertEquals(links[1]?.getAttribute('href'), 'https://x.test')
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('transient Session progress renders as plain provider-neutral text', () => {
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
          rev: 3,
        },
      }),
      root,
    )
    assertEquals(
      root.querySelector('.Session_Agent')?.textContent,
      '**answer** <b>raw</b>',
    )
    assertEquals(
      root.querySelector('.Session_Reason')?.textContent,
      '[reason](javascript:alert(1))',
    )
    assertEquals(root.querySelector('a'), null)
    assertEquals(root.querySelector('b'), null)
    assertEquals(root.querySelector('.Session_ToolName')?.textContent, 'shell')
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
