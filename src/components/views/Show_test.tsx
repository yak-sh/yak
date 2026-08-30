// The full document face's section renderers — especially the meta line,
// where an absent field must paint nothing. A renderer is a component: every
// case mounts it through Preact (mount.ts) and asserts on the resulting DOM,
// never on a bare call's vnode tree.
import { h } from 'preact'
import { assertEquals, assertExists } from '@std/assert'
import { cache, deps, ent } from '../../live.ts'
import { resolve } from '../registry.ts'
import { mount } from '../mount.ts'
import '../Entity.tsx'

Deno.test('task acceptance is a distinct Markdown section', () => {
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Ship it', body: 'Implementation notes' },
      task: { eid: 'task', priority: 1 },
      accept: { eid: 'task', body: '- exits zero' },
    },
  }
  let e = ent('task')
  let { root, free } = mount(h(resolve(e, 'Acceptance').Render, { e }))
  try {
    assertEquals(
      root.querySelector('.Show_AcceptanceTitle')?.textContent,
      'Acceptance',
    )
    assertEquals(
      root.querySelector('.Show_AcceptanceBody li')?.textContent,
      'exits zero',
    )
  } finally {
    free()
    cache.value = {}
  }
})

Deno.test('document meta paints no tally when it has no comments', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Quiet document', body: '' },
    },
  }

  let e = ent('doc')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e, id: true }))
  assertEquals(root.querySelector('.Show_Comments'), null)
  free()
  cache.value = {}
})

Deno.test('empty document meta remains a first-class null', () => {
  cache.value = {
    doc: {
      entity: { eid: 'doc', num: 1 },
      doc: { eid: 'doc', title: 'Quiet document', body: '' },
    },
  }

  let e = ent('doc')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e }))
  assertEquals(root.innerHTML, '')
  free()
  cache.value = {}
})

Deno.test('proposal meta distinguishes pending, cancelled, and approved', () => {
  let proposal = {
    entity: { eid: 'proposal', num: 1 },
    doc: { eid: 'proposal', title: 'A proposal', body: '' },
    proposed: { eid: 'proposal', at: '2026-08-10T12:00:00Z' },
  }

  cache.value = { proposal }
  let e = ent('proposal')
  let a = mount(h(resolve(e, 'Meta').Render, { e }))
  assertExists(a.root.querySelector('.Show_Proposal-proposed .Icon'))
  assertEquals(
    a.root.querySelector('.Show_Proposal')?.getAttribute('aria-label'),
    'proposed',
  )
  a.free()

  cache.value = {
    proposal: {
      ...proposal,
      task: { eid: 'proposal', priority: 1 },
      cancelled: { eid: 'proposal' },
    },
  }
  e = ent('proposal')
  let b = mount(h(resolve(e, 'Meta').Render, { e }))
  assertExists(b.root.querySelector('.Show_Proposal-cancelled .Icon'))
  assertEquals(
    b.root.querySelector('.Show_Proposal')?.getAttribute('aria-label'),
    'cancelled',
  )
  b.free()

  cache.value = {
    proposal: {
      ...proposal,
      decided: { eid: 'proposal', at: '2026-08-10T13:00:00Z' },
    },
  }
  e = ent('proposal')
  let c = mount(h(resolve(e, 'Meta').Render, { e }))
  assertExists(c.root.querySelector('.Show_Proposal-approved .Icon'))
  assertEquals(
    c.root.querySelector('.Show_Proposal')?.getAttribute('aria-label'),
    'approved',
  )
  c.free()
  cache.value = {}
})

Deno.test('a superseded entity is marked on its face with what replaced it', () => {
  cache.value = {
    old: {
      entity: { eid: 'old', num: 12 },
      doc: { eid: 'old', title: '8.5×8.5 square', body: '' },
    },
    cur: {
      entity: { eid: 'cur', num: 13 },
      doc: { eid: 'cur', title: '8×10 portrait', body: '' },
    },
  }
  deps.value = [{ parent: 'cur', type: 'supersedes', child: 'old' }]

  // The superseded end wears the mark — visible on its own face, pointing
  // to the current one; a bare doc with no other meta still renders it.
  let e = ent('old')
  let a = mount(h(resolve(e, 'Meta').Render, { e }))
  let mark = a.root.querySelector('.Show_Superseded')
  assertExists(mark)
  assertEquals(mark!.textContent?.includes('superseded by'), true)
  let successor = a.root.querySelector('.Show_Superseded .Inline')
  assertExists(successor)
  assertEquals(successor!.textContent, '8×10 portrait')
  a.free()

  // The current end is not marked — it did the replacing.
  let c = ent('cur')
  let b = mount(h(resolve(c, 'Meta').Render, { e: c }))
  assertEquals(b.root.querySelector('.Show_Superseded'), null)
  b.free()

  deps.value = []
  cache.value = {}
})

Deno.test('task meta carries both full facts and compact edge tallies', () => {
  let project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let person = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  let session = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  let now = new Date().toISOString()
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Everything', body: '' },
      task: {
        eid: 'task',
        priority: 1,
        project: project,
        assignee: person,
        domain: 'Eng',
      },
      claim: { eid: 'task', session: session },
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
      task: { eid: 'open', priority: 1 },
    },
    done: {
      entity: { eid: 'done', num: 6 },
      task: { eid: 'done', priority: 1 },
      completed: { eid: 'done' },
    },
    child: {
      entity: { eid: 'child', num: 7 },
      doc: { eid: 'child', title: 'Part', body: '' },
    },
    comment: {
      entity: { eid: 'comment', num: 8 },
      doc: { eid: 'comment', title: '', body: 'Watching' },
      comment: { eid: 'comment', target: 'task' },
    },
  }
  deps.value = [
    { parent: 'task', type: 'requires', child: 'open' },
    { parent: 'task', type: 'requires', child: 'done' },
    { parent: 'task', type: 'contains', child: 'child' },
    { parent: 'task', type: 'reads', child: 'done' },
  ]
  let e = ent('task')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e, id: true }))
  try {
    assertEquals(root.querySelector('.Show_Project')?.textContent, 'Task Graph')
    assertEquals(root.querySelector('.Show_Domain')?.textContent, 'Eng')
    assertEquals(root.querySelector('.Show_Assignee')?.textContent, 'Jeff')
    let comments = root.querySelector('.Show_Comments')!
    assertEquals(comments.textContent.trim(), '1')
    assertEquals(
      comments.querySelector('svg')?.getAttribute('class'),
      'lucide lucide-message-circle Icon',
    )
    assertEquals(comments.getAttribute('data-tip'), '1 comment')
    assertEquals(
      root.querySelector('.Show_Deps-requires')?.textContent,
      '11',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains')?.textContent,
      '1',
    )
    assertEquals(root.querySelector('.Show_Deps-reads')?.textContent, '1')
    assertEquals(
      root.querySelector('.Show_Deps-requires')?.getAttribute('data-tip'),
      'requires 1 done · 1 open',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains svg')?.getAttribute('class'),
      'lucide lucide-box Icon',
    )
    assertEquals(
      root.querySelector('.Show_Deps-contains')?.getAttribute('aria-label'),
      'contains 1',
    )
    assertEquals(
      root.querySelector('.Show_Deps-reads svg')?.getAttribute('class'),
      'lucide lucide-book-open Icon',
    )
    assertEquals(root.querySelector('.Show_Done')?.textContent, '1')
    assertEquals(root.querySelector('.Show_Claim')?.textContent, '⚑ S-4')
    assertEquals(
      root.querySelector('.Show_Claim')?.getAttribute('href'),
      '/S-4',
    )
    assertExists(root.querySelector('.Stamp'))
    assertEquals(root.querySelector('.Id')?.textContent, 'T-1')
  } finally {
    free()
    deps.value = []
    cache.value = {}
  }
})

Deno.test('mail Full section shows its envelope and delivery receipt', () => {
  cache.value = {
    mail: {
      entity: { eid: 'mail', num: 1 },
      doc: { eid: 'mail', title: 'Hello', body: '' },
      mail: {
        eid: 'mail',
        from: 'sender@x.test',
        to_addr: 'desk@x.test',
        sent_id: 'sent@x.test',
      },
      // WHERE it went — the shared deliver.to (D-14945); to_addr is the
      // address that reference resolved to.
      deliver: { eid: 'mail', to: 'P-2' },
      // The send outcome is the shared delivered facet now (D-14945).
      delivered: {
        eid: 'mail',
        at: '2026-07-30T12:00:00Z',
        via: 'sent@x.test',
      },
    },
  }
  let a = mount(h(resolve(ent('mail'), 'Mail').Render, { e: ent('mail') }))
  assertEquals(
    [...a.root.querySelectorAll('.Show_MailKey')].map((x) => x.textContent),
    ['from', 'requested', 'to', 'sent'],
  )
  assertEquals(
    [...a.root.querySelectorAll('.Show_MailVal')].slice(0, 3).map((x) =>
      x.textContent
    ),
    ['sender@x.test', 'P-2', 'desk@x.test'],
  )
  assertEquals(a.root.querySelector('.Stamp') != null, true)
  a.free()

  cache.value = {
    mail: {
      entity: { eid: 'mail', num: 1 },
      doc: { eid: 'mail', title: 'Hello', body: '' },
      mail: {
        eid: 'mail',
        to_addr: 'desk@x.test',
        from: 'stranger@x.test',
        message_id: 'received@x.test',
        received_at: '2026-07-30T13:00:00Z',
        verified: 0,
      },
    },
  }
  let b = mount(h(resolve(ent('mail'), 'Mail').Render, { e: ent('mail') }))
  assertEquals(
    [...b.root.querySelectorAll('.Show_MailKey')].map((x) => x.textContent),
    ['from', 'to', 'received', 'verified'],
  )
  assertEquals(
    b.root.querySelector('.Show_MailVal-unverified')?.textContent,
    'no',
  )
  b.free()
  cache.value = {}
})

Deno.test('document meta names its creator and editor after their ages', () => {
  let jeff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let robin = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
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
  let e = ent('doc')
  let { root, free } = mount(h(resolve(e, 'Meta').Render, { e }))
  try {
    assertEquals(
      root.querySelector('.Stamp')?.textContent,
      '2 days ago by Jeff· edited 18 hours ago by Robin',
    )
    assertEquals(
      [...root.querySelectorAll('.Stamp a')].map((a) => a.getAttribute('href')),
      ['/U-2', '/U-3'],
    )
  } finally {
    free()
    cache.value = {}
  }
})

Deno.test('a hook-using renderer mounts through the helper', () => {
  // The task title's Pip holds useState — a hook-using renderer only works
  // mounted through Preact. A bare call would throw here; the helper mounts it.
  cache.value = {
    task: {
      entity: { eid: 'task', num: 1 },
      doc: { eid: 'task', title: 'Hooked', body: '' },
      task: { eid: 'task', status: 'open', priority: 1 },
    },
  }
  let e = ent('task')
  let { root, free } = mount(h(resolve(e, 'Card.Title').Render, { e }))
  assertExists(root.querySelector('.CardTitle'))
  assertEquals(root.querySelector('.Id')?.textContent, 'T-1')
  free()
  cache.value = {}
})

Deno.test('comment dependencies lead with the entity commented on', () => {
  cache.value = {
    comment: {
      entity: { eid: 'comment', num: 2 },
      doc: { eid: 'comment', title: '', body: 'A note' },
      comment: { eid: 'comment', target: 'target' },
    },
    target: {
      entity: { eid: 'target', num: 1 },
      doc: { eid: 'target', title: 'The subject', body: '' },
    },
  }

  let e = ent('comment')
  let { root, free } = mount(h(resolve(e, 'Dependencies').Render, { e }))
  // The first edge sentence is the target, verbed 'on'.
  assertEquals(root.querySelector('.Dependency_Type')?.textContent, 'on')
  assertEquals(root.querySelector('.Inline_Title')?.textContent, 'The subject')
  free()
  cache.value = {}
})
