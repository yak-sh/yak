// The full document face's section renderers — especially the meta line,
// where an absent field must paint nothing.
import { render, type VNode } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
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
        acted_at: '2026-07-30T12:00:00Z',
        sent_id: 'sent@x.test',
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
      '2 days ago by U-2 — Jeff· edited 18 hours ago by U-3 — Robin',
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
