// The full document face's section renderers — especially the meta line,
// where an absent field must paint nothing.
import { render, type VNode } from 'preact'
import { assertEquals, assertExists } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, deps, ent } from '../../live.ts'
import { resolve } from '../registry.ts'
import '../Entity.tsx'

let raw = (v: VNode) =>
  (Array.isArray(v.props.children) ? v.props.children : [v.props.children])
    .flat()

Deno.test('document meta paints no tally when it has no comments', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Quiet document', body: '' },
    },
  }

  let e = ent('doc')
  let meta = resolve(e, 'Meta').Render({ e, id: true })!
  assertEquals(raw(meta).filter((c) => typeof c == 'number'), [])
})

Deno.test('empty document meta remains a first-class null', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Quiet document', body: '' },
    },
  }

  let e = ent('doc')
  assertEquals(resolve(e, 'Meta').Render({ e }), null)
})

Deno.test('task meta carries both full facts and compact edge tallies', () => {
  let project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let person = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let now = new Date().toISOString()
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Everything', body: '' },
      task: {
        eid: 'task',
        status: 'open',
        priority: 1,
        project_eid: project,
        assignee_eid: person,
        domain: 'Eng',
      },
      claim: { eid: 'task', session_eid: session },
      created: { eid: 'task', at: now, by: person },
    },
    [project]: {
      entity: { eid: project, num: 2 },
      doc: { eid: project, title: 'Task Graph', body: '' },
      project: { eid: project },
    },
    [person]: {
      entity: { eid: person, num: 3 },
      doc: { eid: person, title: 'Jeff', body: '' },
      person: { eid: person },
    },
    [session]: {
      entity: { eid: session, num: 4 },
      session: { eid: session, id: 'run' },
    },
    open: {
      entity: { eid: 'open', num: 5 },
      task: { eid: 'open', status: 'open', priority: 1 },
    },
    done: {
      entity: { eid: 'done', num: 6 },
      task: { eid: 'done', status: 'done', priority: 1 },
    },
    child: {
      entity: { eid: 'child', num: 7 },
      doc: { eid: 'child', title: 'Part', body: '' },
    },
    comment: {
      entity: { eid: 'comment', num: 8 },
      doc: { eid: 'comment', title: '', body: 'Watching' },
      comment: { eid: 'comment', target_eid: 'task' },
    },
  }
  deps.value = [
    { parent: 'task', type: 'requires', child: 'open' },
    { parent: 'task', type: 'requires', child: 'done' },
    { parent: 'task', type: 'contains', child: 'child' },
    { parent: 'task', type: 'reads', child: 'done' },
  ]
  let root = document.querySelector('main')!
  try {
    let e = ent('task')
    render(resolve(e, 'Meta').Render({ e, id: true })!, root)
    assertEquals(root.querySelector('.Show_Project')?.textContent, 'Task Graph')
    assertEquals(root.querySelector('.Show_Domain')?.textContent, 'Eng')
    assertEquals(root.querySelector('.Show_Assignee')?.textContent, 'Jeff')
    assertEquals(root.querySelector('.Show_Comments')?.textContent, '💬 1')
    assertEquals(
      root.querySelector('.Show_Deps-requires')?.textContent,
      'requires 1 1',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains')?.textContent,
      'contains 1',
    )
    assertEquals(root.querySelector('.Show_Deps-reads')?.textContent, 'reads 1')
    assertEquals(root.querySelector('.Show_Done')?.textContent, '1')
    assertEquals(root.querySelector('.Show_Claim')?.textContent, '⚑ S-4')
    assertEquals(
      root.querySelector('.Show_Claim')?.getAttribute('href'),
      '/S-4',
    )
    assertExists(root.querySelector('.Stamp'))
    assertEquals(root.querySelector('.Id')?.textContent, 'T-1')
  } finally {
    render(null, root)
    deps.value = []
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('mail Full section shows its envelope and delivery receipt', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = {
    mail: {
      entity: { eid: 'mail', num: 1 },
      doc: { eid: 'mail', title: 'Hello', body: '' },
      mail: {
        eid: 'mail',
        to: 'P-2',
        from: 'sender@x.test',
        to_addr: 'desk@x.test',
        sent_id: 'sent@x.test',
      },
      // The send outcome is the shared delivered facet now (D-14945).
      delivered: {
        eid: 'mail',
        at: '2026-07-30T12:00:00Z',
        via: 'sent@x.test',
      },
    },
  }
  let root = document.querySelector('main')!
  try {
    let e = ent('mail')
    render(resolve(e, 'Mail').Render({ e })!, root)
    assertEquals(
      [...root.querySelectorAll('.Show_MailKey')].map((x) => x.textContent),
      ['from', 'requested', 'to', 'sent'],
    )
    assertEquals(
      [...root.querySelectorAll('.Show_MailVal')].slice(0, 3).map((x) =>
        x.textContent
      ),
      ['sender@x.test', 'P-2', 'desk@x.test'],
    )
    assertEquals(root.querySelector('.Stamp') != null, true)

    cache.value = {
      mail: {
        entity: { eid: 'mail', num: 1 },
        doc: { eid: 'mail', title: 'Hello', body: '' },
        mail: {
          eid: 'mail',
          to: 'desk@x.test',
          from: 'stranger@x.test',
          message_id: 'received@x.test',
          received_at: '2026-07-30T13:00:00Z',
          verified: 0,
        },
      },
    }
    e = ent('mail')
    render(resolve(e, 'Mail').Render({ e })!, root)
    assertEquals(
      [...root.querySelectorAll('.Show_MailKey')].map((x) => x.textContent),
      ['from', 'to', 'received', 'verified'],
    )
    assertEquals(
      root.querySelector('.Show_MailVal-unverified')?.textContent,
      'no',
    )
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('document meta names its creator and editor after their ages', () => {
  let jeff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let robin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let now = Date.now()
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Changed document', body: '' },
      created: {
        eid: 'doc',
        at: new Date(now - 2 * 86_400_000).toISOString(),
        by: jeff,
      },
      updated: {
        eid: 'doc',
        at: new Date(now - 18 * 3_600_000).toISOString(),
        by: robin,
      },
    },
    [jeff]: {
      entity: { eid: jeff, num: 2 },
      doc: { eid: jeff, title: 'Jeff', body: '' },
      person: { eid: jeff },
    },
    [robin]: {
      entity: { eid: robin, num: 3 },
      doc: { eid: robin, title: 'Robin', body: '' },
      person: { eid: robin },
    },
  }
  let root = document.querySelector('main')!
  try {
    let e = ent('doc')
    render(resolve(e, 'Meta').Render({ e })!, root)
    assertEquals(
      root.querySelector('.Stamp')?.textContent,
      '2 days ago by Jeff· edited 18 hours ago by Robin',
    )
    assertEquals(
      [...root.querySelectorAll('.Stamp a')].map((a) => a.getAttribute('href')),
      ['/U-2', '/U-3'],
    )
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('comment dependencies lead with the entity commented on', () => {
  cache.value = {
    comment: {
      entity: { eid: 'comment', num: 2 },
      doc: { eid: 'comment', title: '', body: 'A note' },
      comment: { eid: 'comment', target_eid: 'target' },
    },
    target: {
      entity: { eid: 'target', num: 1 },
      doc: { eid: 'target', title: 'The subject', body: '' },
    },
  }

  let e = ent('comment')
  let renderer = resolve(e, 'Dependencies')
  let target = raw(renderer.Render({ e })!)[0]
  assertEquals(target.props, {
    eid: 'target',
    view: 'Dependency',
    type: 'comment',
    label: 'on',
  })
})
