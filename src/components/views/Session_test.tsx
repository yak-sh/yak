// A session row keeps the actor it works for visible in every shared list.
import { h, render, type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import { SessionBody, SessionSummary } from './Session.tsx'

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
