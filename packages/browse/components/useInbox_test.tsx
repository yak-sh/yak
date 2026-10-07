// Exact server summaries, addressed readiness and lifecycle-owned draw/detail rows.
import '../testing.ts'
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { parseHTML } from 'linkedom'
import { type Bundle, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { plugins } from '@yaks/inbox/graph'
import { summaryQuery } from '@yaks/inbox/queries'
import { decode } from '../../api/socket.ts'
import { cache } from '../live.ts'
import { type Ask, host } from '../host_testing.ts'
import { uuid, vocab } from '../types.ts'
import { useInboxCount, useInboxThread, useInboxThreads } from './useInbox.ts'

// The transport adds whole-row coverage to its authored query.
let line = (query: string) => query.replace(/&\*$/, '')
let at = (n: number) => `2026-10-02T12:00:${String(n).padStart(2, '0')}.000Z`

// host's subscribe callback is synchronous; the real graph read is not. Queue
// its answer just as the socket does, and retain read errors for the test.
let shop = async (data: Bundle[], answering = true) => {
  let storage = ram(vocab)
  // Historical fixture authors/times are server facts, not a new stamped write.
  await storage.tx((tx) => tx.patch(data))
  let g: Graph
  g = graph({
    vocab,
    storage,
    plugins: plugins({
      get graph() {
        return g
      },
    }),
  })
  let frames: Bundle[][] = [], errors: unknown[] = [], rejected = 0
  let answer = async (a: Ask) => {
    try {
      let bundles = await g.read(a.subscribe)
      frames.push(bundles)
      await wire.say({ id: a.id, bundles, reset: true })
    } catch (error) {
      errors.push(error)
      await wire.say({
        id: a.id,
        refused: { error: 'read', message: String(error) },
      })
    }
  }
  let wire = host((a) => {
    if ('error' in decode(JSON.stringify({ ...a, acks: true, frames: true }))) {
      rejected++
      return { refused: { error: 'Refused', message: 'oversized subscribe' } }
    }
    if (answering) queueMicrotask(() => void answer(a))
    return undefined
  })
  return {
    g,
    storage,
    wire,
    frames,
    errors,
    rejected: () => rejected,
    answer,
    start: () => {
      answering = true
    },
    summary: (actor: string) =>
      wire.asked().find((a) => line(a.subscribe) == summaryQuery(actor))!,
  }
}
let page = () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = {}
  return {
    root: document.querySelector('main')!,
    free: () => {
      cache.value = {}
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    },
  }
}
let wait = (fact: () => boolean, label: string) =>
  until(async () => {
    await act(() => Promise.resolve())
    return fact()
  }, { label })
let historyAsks = (wire: ReturnType<typeof host>) =>
  wire.asked().filter((a) =>
    a.subscribe.includes('.comment.target=') ||
    a.subscribe.includes('.entry.session=') ||
    a.subscribe.includes('.created.by=') ||
    a.subscribe.includes('.subscription.actor=')
  )

test('inbox summary counts wait for the answer, share holds, deduplicate and respect watch/mute', async () => {
  let p = page()
  let actor = uuid(),
    target = uuid(),
    mine = uuid(),
    watched = uuid(),
    sub = uuid()
  let s = await shop([
    { entity: { eid: actor }, person: {}, email: { address: 'p@example.com' } },
    {
      entity: { eid: target },
      task: {},
      doc: { title: 'Thread' },
      created: { at: at(1) },
    },
    {
      entity: { eid: mine },
      comment: { target },
      doc: { body: 'What now?' },
      created: { by: actor, at: at(2) },
    },
    ...[3, 4].map((n) => ({
      entity: { eid: uuid() },
      comment: { target, reply_to: mine },
      doc: { body: 'Answer' },
      created: { at: at(n) },
    })),
    { entity: { eid: watched }, task: {}, completed: { at: at(5) } },
  ], false)
  let View = () => <span>{useInboxCount(actor) ?? '?'}</span>
  let mount = (n: number) =>
    act(() =>
      render(
        h('div', {}, Array.from({ length: n }, (_, key) => h(View, { key }))),
        p.root,
      )
    )
  try {
    await mount(2)
    await wait(() => s.wire.asked().length > 0, 'summary requested')
    assertEquals(p.root.textContent, '??')
    assertEquals(s.wire.asked().map((a) => line(a.subscribe)), [
      summaryQuery(actor),
    ])
    s.start()
    await act(() => s.answer(s.summary(actor)))
    await wait(
      () => p.root.textContent == '11',
      'one thread, not two reply messages',
    )
    assertEquals(historyAsks(s.wire), [])
    assertEquals(
      s.wire.asked().filter((a) => line(a.subscribe) == summaryQuery(actor))
        .length,
      1,
    )
    let summary = s.summary(actor)
    await act(() =>
      s.wire.say({
        id: summary.id,
        refused: { error: 'read', message: 'denied' },
      })
    )
    assertEquals(p.root.textContent, '??')
    await act(() => s.answer(summary))
    await wait(() => p.root.textContent == '11', 'ready after summary retry')
    await s.g.apply([{
      entity: { eid: sub },
      subscription: { actor, target: watched, mode: 'watch' },
    }])
    await act(() => s.answer(summary))
    await wait(() => p.root.textContent == '22', 'watched state change counts')
    await s.g.apply([{ entity: { eid: sub }, subscription: { mode: 'mute' } }])
    await act(() => s.answer(summary))
    await wait(() => p.root.textContent == '11', 'muted thread does not count')
    let asks = s.wire.asked().length
    await mount(1)
    assertEquals(s.wire.asked().length, asks)
    assertEquals(s.wire.sent.some((m) => m.unsubscribe == summary.id), false)
    await mount(0)
    assertEquals(s.wire.sent.filter((m) => m.unsubscribe).length, asks)
    assertEquals(s.errors, [])
  } finally {
    await act(() => render(null, p.root))
    s.wire.free()
    p.free()
  }
})

test('a large inbox asks one summary, holds only root/latest draw rows and loads full messages only for detail', async () => {
  let p = page(), actor = uuid()
  let data: Bundle[] = [{ entity: { eid: actor }, person: {} }]
  let roots: string[] = [], newest: string[] = [], older: string[] = []
  let hidden = 'Historical words only requested by detail. '.repeat(100)
  for (let i = 0; i < 600; i++) {
    let target = uuid(), mine = uuid(), reply = uuid()
    roots.push(target)
    older.push(mine)
    newest.push(reply)
    data.push(
      { entity: { eid: target }, task: {}, doc: { title: `Thread ${i}` } },
      {
        entity: { eid: mine },
        comment: { target },
        doc: { body: hidden },
        created: { by: actor, at: at(1) },
      },
      {
        entity: { eid: reply },
        comment: { target, reply_to: mine },
        doc: { body: `Newest ${i}` },
        created: { at: at(2) },
      },
    )
  }
  let s = await shop(data)
  let list: ReturnType<typeof useInboxThreads> | undefined
  let detail: ReturnType<typeof useInboxThread> | undefined
  let List = () => {
    list = useInboxThreads(actor)
    return (
      <span>
        {list.ready ? list.threads.filter((t) => t.unread).length : '?'}
      </span>
    )
  }
  let Detail = () => {
    detail = useInboxThread(actor, roots[0])
    return (
      <span>{detail.ready ? detail.threads[0]?.messages.length : '?'}</span>
    )
  }
  let mount = (open: boolean) =>
    act(() =>
      render(
        <div>
          <List />
          {open && <Detail />}
        </div>,
        p.root,
      )
    )
  try {
    await mount(false)
    await wait(
      () => p.root.textContent == '600',
      'all 600 exact summary threads ready',
    )
    await wait(
      () => newest.every((eid) => !!cache.peek()[eid]?.doc),
      'draw rows delivered',
    )
    assertEquals(list!.threads.length, 600)
    assertEquals(list!.threads.every((t) => t.messages.length == 0), true)
    assertEquals(
      list!.threads.every((t) =>
        t.row.comps.doc?.body === undefined &&
        t.latest.comps.doc?.body === undefined
      ),
      true,
    )
    assertEquals(list!.threads.map((t) => t.eid).toSorted(), roots.toSorted())
    assertEquals(historyAsks(s.wire), [])
    assertEquals(
      s.wire.asked().filter((a) =>
        a.subscribe.startsWith('.inbox_summary.actor=')
      ).length,
      1,
    )
    assertEquals(older.some((eid) => !!cache.peek()[eid]), false)
    assertEquals(JSON.stringify(s.frames).includes(hidden), false)
    assertEquals(s.rejected(), 0)
    assertEquals(s.wire.dials(), 1)
    await mount(true)
    await wait(
      () => detail?.ready == true && detail.threads[0]?.messages.length == 2,
      'full detail messages ready',
    )
    assertEquals(detail!.threads[0].messages.map((r) => r.eid), [
      older[0],
      newest[0],
    ])
    assertEquals(detail!.threads[0].messages[0].comps.doc.body, hidden)
    await wait(
      () => !!cache.peek()[older[0]]?.doc,
      'detail holds historical row',
    )
    assertEquals(historyAsks(s.wire), [])
    let detailAsk = s.wire.asked().find((a) =>
      line(a.subscribe) == summaryQuery(actor, { all: true }, roots[0])
    )!
    await mount(false)
    assertEquals(s.wire.sent.some((m) => m.unsubscribe == detailAsk.id), true)
    assertEquals(
      s.wire.sent.some((m) => m.unsubscribe == s.summary(actor).id),
      false,
    )
    assertEquals(s.errors, [])
  } finally {
    await act(() => render(null, p.root))
    s.wire.free()
    p.free()
  }
})

test('summary replacement discovers and removes membership without subscribing to history', async () => {
  let p = page(), actor = uuid(), first = uuid(), next = uuid()
  let s = await shop([
    { entity: { eid: actor }, person: {} },
    {
      entity: { eid: first },
      task: {},
      doc: { title: 'First' },
      created: { by: actor, at: at(1) },
    },
  ])
  let found: ReturnType<typeof useInboxThreads> | undefined
  let View = () => {
    found = useInboxThreads(actor)
    return (
      <span>
        {found.ready ? found.threads.map((t) => t.eid).join(',') : '?'}
      </span>
    )
  }
  try {
    await act(() => render(<View />, p.root))
    await wait(() => p.root.textContent == first, 'first summary membership')
    let summary = s.summary(actor)
    await s.storage.tx((tx) =>
      tx.patch([{
        entity: { eid: next },
        task: {},
        filed: { assignee: actor },
        doc: { title: 'New assignment' },
        created: { at: at(2) },
      }])
    )
    await act(() => s.answer(summary))
    await wait(
      () => found?.threads.length == 2,
      'new assignment enters existing summary',
    )
    assertEquals(found!.threads.find((t) => t.eid == next)?.lane, 'Needs you')
    await wait(() => !!cache.peek()[next]?.doc, 'new root draw row delivered')
    await s.storage.tx((tx) =>
      tx.patch([{ entity: { eid: first }, archived: { at: at(3) } }])
    )
    await act(() => s.answer(summary))
    await wait(() => p.root.textContent == next, 'archived root leaves summary')
    assertEquals(historyAsks(s.wire), [])
    assertEquals(
      s.wire.asked().filter((a) =>
        a.subscribe.startsWith('.inbox_summary.actor=')
      ).map((a) => a.id),
      [summary.id],
    )
    assertEquals(s.wire.sent.some((m) => m.unsubscribe == summary.id), false)
    await act(() => render(null, p.root))
    assertEquals(
      s.wire.sent.filter((m) => m.unsubscribe).length,
      s.wire.asked().length,
    )
    assertEquals(s.errors, [])
  } finally {
    await act(() => render(null, p.root))
    s.wire.free()
    p.free()
  }
})
