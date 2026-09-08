import { assert, assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { acked, cache, ent, useRoute } from '../live.ts'
import { Entity } from './Entity.tsx'
import type { Change } from '../types.ts'
import { Pip } from './views/Show.tsx'
import { resolve, vocab } from './registry.ts'

// These fields portal into the page body, so exercise the browser's full
// mount shape while keeping subscriptions off the transport.
let page = () => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let globals = {
    document,
    innerWidth: 1000,
    innerHeight: 800,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  }
  let prior = Object.keys(globals).map((name) =>
    [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  )
  for (let [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true })
  }
  let sent: Change[] = []
  let restore = useRoute((frame) => {
    let write = frame as { apply?: Change[]; id: string }
    if (write.apply) {
      sent.push(...write.apply)
      acked(write.id)
    }
  })
  let root = document.querySelector('main')!
  let eid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [eid]: {
      entity: { eid, num: 1 },
      doc: { eid, title: 'A task', body: 'Stored body' },
      task: { eid, priority: 2 },
    },
  }
  return {
    root,
    document,
    eid,
    sent,
    free() {
      render(null, root)
      useRoute(restore)
      cache.value = {}
      for (let [name, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete (globalThis as Record<string, unknown>)[name]
      }
    },
  }
}

let row = (root: Element, col: string) =>
  [...root.querySelectorAll('.Props_Row')].find((row) =>
    row.querySelector('dt')?.textContent == col
  )!

Deno.test('component properties open anchored reference and enum controls', async () => {
  let { root, document, eid, free } = page()
  try {
    for (
      let [comp, col, control] of [
        ['task', 'project', '.Prop_Pop-list .Prop_Find'],
        ['member', 'role', '.Prop_Tab'],
      ]
    ) {
      render(h(Entity, { eid, view: 'Props', comp }), root)
      assertEquals(
        [...root.querySelectorAll('dt')].map((el) => el.textContent),
        vocab.columns(comp),
      )
      assertEquals(document.querySelector('.Overlay'), null)
      let field = row(root, col).querySelector<HTMLSpanElement>('.Prop_Val')!
      field.click()
      await Promise.resolve()
      assert(document.querySelector(`.Overlay ${control}`))
      let popup = document.querySelector<HTMLElement>('.Overlay')!
      assert(popup.style.left, 'the field supplies the popup anchor')
      assertEquals(
        row(root, col).querySelector('.Prop_Val')?.textContent,
        field.textContent,
      )
      render(null, root)
    }
  } finally {
    free()
  }
})

Deno.test('properties stay closed and native read-only fields have no edit press', () => {
  let { root, document, eid, free } = page()
  try {
    render(h(Entity, { eid, view: 'Props', comp: 'doc' }), root)
    assertEquals(root.querySelector('.Edit'), null)
    assertEquals(
      row(root, 'body').querySelector('dd')?.textContent,
      'Stored body',
    )
    render(h(Entity, { eid, view: 'Props', comp: 'task' }), root)
    assertEquals(row(root, 'status').querySelector('dd')?.textContent, 'open')
    assertEquals(row(root, 'status').querySelector('.Prop-live'), null)
    for (
      let [comp, col, readOnly] of [
        ['task', 'priority', true],
        ['task', 'status', false],
        ['session', 'status', false],
      ] as const
    ) {
      render(h(Entity, { eid, view: 'Edit', comp, col, readOnly }), root)
      assertEquals(root.querySelector('.Prop-live'), null)
      assertEquals(root.querySelector('input, [contenteditable]'), null)
      assertEquals(document.querySelector('.Overlay'), null)
    }
  } finally {
    free()
  }
})

Deno.test('native resolve callers can mount a portable property list', () => {
  let { root, eid, free } = page()
  try {
    let e = ent(eid)
    let props = resolve(e, 'Props')
    assertEquals(resolve(e, 'Props').Render, props.Render)
    render(h(props.Render, { e, comp: 'task', readOnly: true }), root)
    assert(root.querySelector('dl.Props'))
    assertEquals(
      root.querySelectorAll('.Props_Row').length,
      vocab.columns('task').length,
    )
    assertEquals(root.querySelector('.Prop-live'), null)
  } finally {
    free()
  }
})

Deno.test('portable property editors apply through the app host and status uses marks', async () => {
  let { root, document, eid, sent, free } = page()
  try {
    render(h(Entity, { eid, view: 'Props', comp: 'repo' }), root)
    let checkbox = row(root, 'push').querySelector<HTMLInputElement>('input')!
    checkbox.checked = true
    checkbox.dispatchEvent(
      new document.defaultView!.Event('change', { bubbles: true }),
    )
    assertEquals(sent, [{ eid, name: 'repo', comp: { push: 1 } }])
    assertEquals(Number(cache.value[eid]?.repo?.push), 1)
    render(h(Pip, { e: ent(eid) }), root)
    root.querySelector<HTMLElement>('.Show_Pip')!.click()
    await Promise.resolve()
    let done = [...document.querySelectorAll<HTMLButtonElement>('.Prop_Tab')]
      .find((tab) => tab.textContent == 'done')!
    done.click()
    assert(sent.slice(1).some((change) => change.name == 'completed'))
    assert(
      !sent.some((change) =>
        change.name == 'task' && change.comp && 'status' in change.comp
      ),
    )
  } finally {
    free()
  }
})
