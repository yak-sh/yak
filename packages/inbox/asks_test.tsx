/** @jsxImportSource preact */
// The views read one exact summary, hold only the rows they draw, and read a
// thread's history only while it is open.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import type { Bundle } from '@yaks/graph'
import { decode } from '@yaks/api'
import { summaryQuery } from './queries.ts'
import { type Threads, useThread, useThreads, waiting } from './asks.ts'
import { host, mount, shop, texts, wait } from './testing.tsx'

let at = (n: number) => `2026-10-02T12:00:${String(n).padStart(2, '0')}.000Z`
let id = () => crypto.randomUUID()

// What reads a thread's history row by row: none of it is ever asked.
let history = (lines: string[]) =>
  lines.filter((l) =>
    l.includes('.comment.target=') || l.includes('.entry.session=') ||
    l.includes('.created.by=') || l.includes('.subscription.actor=')
  )
let summaries = (lines: string[]) =>
  lines.filter((l) => l.startsWith('.inbox_summary.actor='))

test('counts wait for the summary, ask the list’s one line, and follow watch and mute', async () => {
  let actor = id(), target = id(), mine = id(), watched = id(), sub = id()
  let g = await shop([
    { entity: { eid: actor }, doc: { title: 'Person' } },
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
      entity: { eid: id() },
      comment: { target, reply_to: mine },
      doc: { body: 'Answer' },
      created: { at: at(n) },
    })),
    { entity: { eid: watched }, task: {}, completed: { at: at(5) } },
  ])
  let h = host({ read: (l) => g.read(l), answering: false })
  let summary = summaryQuery(actor)
  let Count = () => (
    <span>{waiting({ entity: { eid: actor } }, h.io) ?? '?'}</span>
  )
  let page = mount(<main />)
  let show = (n: number) =>
    act(() =>
      render(
        <div>{Array.from({ length: n }, (_, key) => <Count key={key} />)}</div>,
        page.root,
      )
    )
  try {
    await show(2)
    assertEquals(page.root.textContent, '??')
    assertEquals(h.asked, [summary])
    h.start()
    await act(() => h.answer(summary))
    await wait(
      () => page.root.textContent == '11',
      'one thread, not two replies',
    )
    assertEquals(history(h.asked), [])
    assertEquals(summaries(h.asked), [summary])
    await act(() => h.refuse(summary, 'denied'))
    assertEquals(page.root.textContent, '??')
    await act(() => h.answer(summary))
    await wait(() => page.root.textContent == '11', 'ready after a retry')
    await g.apply([{
      entity: { eid: sub },
      subscription: { actor, target: watched, mode: 'watch' },
    }])
    await act(() => h.answer(summary))
    await wait(() => page.root.textContent == '22', 'a watched change counts')
    await g.apply([{ entity: { eid: sub }, subscription: { mode: 'mute' } }])
    await act(() => h.answer(summary))
    await wait(() => page.root.textContent == '11', 'a muted thread does not')
    let asked = h.asked.length
    await show(1)
    assertEquals(h.asked.length, asked)
    assertEquals(h.dropped.includes(summary), false)
    await show(0)
    assertEquals(h.held(), [])
    assertEquals(h.dropped.includes(summary), true)
    assertEquals(h.errors, [])
  } finally {
    page.free()
  }
})

test('a large inbox asks one summary, holds only root and newest rows, and reads history only for an open thread', async () => {
  let actor = id()
  let rows: Bundle[] = [{ entity: { eid: actor }, doc: { title: 'Person' } }]
  let roots: string[] = [], newest: string[] = [], older: string[] = []
  let hidden = 'Historical words only requested by detail. '.repeat(100)
  for (let i = 0; i < 600; i++) {
    let target = id(), mine = id(), reply = id()
    roots.push(target)
    older.push(mine)
    newest.push(reply)
    rows.push(
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
  let g = await shop(rows)
  let h = host({ read: (l) => g.read(l) })
  let list: Threads | undefined, detail: Threads | undefined
  let List = () => {
    list = useThreads(h.io, actor)
    return (
      <span>
        {list.ready ? list.threads.filter((t) => t.unread).length : '?'}
      </span>
    )
  }
  let Detail = () => {
    detail = useThread(h.io, actor, roots[0])
    return (
      <span>{detail.ready ? detail.threads[0]?.messages.length : '?'}</span>
    )
  }
  let page = mount(<main />)
  let show = (open: boolean) =>
    act(() =>
      render(
        <div>
          <List />
          {open && <Detail />}
        </div>,
        page.root,
      )
    )
  try {
    await show(false)
    await wait(() => page.root.textContent == '600', 'all 600 threads ready')
    assertEquals(newest.every((eid) => !!h.io.get(eid)?.doc), true)
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
    assertEquals(history(h.asked), [])
    assertEquals(summaries(h.asked), [summaryQuery(actor)])
    assertEquals(older.some((eid) => !!h.io.get(eid)), false)
    // Every line fits the socket a browsing app asks it on.
    assertEquals(
      h.asked.filter((subscribe) =>
        'error' in decode(JSON.stringify({ subscribe, id: 's1', acks: true }))
      ),
      [],
    )
    await show(true)
    await wait(
      () => detail?.ready == true && detail.threads[0]?.messages.length == 2,
      'the open thread’s messages',
    )
    assertEquals(detail!.threads[0].messages.map((r) => r.eid), [
      older[0],
      newest[0],
    ])
    assertEquals(detail!.threads[0].messages[0].comps.doc.body, hidden)
    await wait(() => !!h.io.get(older[0])?.doc, 'the open thread’s rows held')
    assertEquals(history(h.asked), [])
    await show(false)
    assertEquals(
      h.dropped.includes(summaryQuery(actor, { all: true }, roots[0])),
      true,
    )
    assertEquals(h.dropped.includes(summaryQuery(actor)), false)
    assertEquals(h.errors, [])
  } finally {
    page.free()
  }
})

test('a summary is not a populated page until the rows it draws arrive', async () => {
  let actor = id(), task = id()
  let g = await shop([
    { entity: { eid: actor }, doc: { title: 'Person' } },
    {
      entity: { eid: task },
      task: {},
      filed: { assignee: actor },
      doc: { title: 'Assigned' },
    },
  ])
  let h = host({ read: (l) => g.read(l), answering: false })
  let View = () => {
    let found = useThreads(h.io, actor)
    return <span>{found.ready ? found.threads.length : '?'}</span>
  }
  let page = mount(<View />)
  try {
    await act(() => h.answer(summaryQuery(actor)))
    await wait(() => h.asked.length == 2, 'its rows asked')
    assertEquals(page.root.textContent, '?')
    await act(() => h.answer(h.asked[1]))
    await wait(() => page.root.textContent == '1', 'ready with its rows')
  } finally {
    page.free()
  }
})

test('a new summary brings a thread in and takes an archived one out, asking no history', async () => {
  let actor = id(), first = id(), next = id()
  let g = await shop([
    { entity: { eid: actor }, doc: { title: 'Person' } },
    {
      entity: { eid: first },
      task: {},
      doc: { title: 'First' },
      created: { by: actor, at: at(1) },
    },
  ])
  let h = host({ read: (l) => g.read(l) })
  let found: Threads | undefined
  let View = () => {
    found = useThreads(h.io, actor)
    return <span>{found.ready ? found.threads.map((t) => t.eid) : '?'}</span>
  }
  let page = mount(<View />)
  let summary = summaryQuery(actor)
  try {
    await wait(() => page.root.textContent == first, 'first membership')
    await g.storage.tx((tx) =>
      tx.patch([{
        entity: { eid: next },
        task: {},
        filed: { assignee: actor },
        doc: { title: 'New assignment' },
        created: { at: at(2) },
      }])
    )
    await act(() => h.answer(summary))
    await wait(() => found?.threads.length == 2, 'a new assignment enters')
    assertEquals(found!.threads.find((t) => t.eid == next)?.lane, 'Needs you')
    await wait(() => !!h.io.get(next)?.doc, 'its row is drawn')
    await g.storage.tx((tx) =>
      tx.patch([{ entity: { eid: first }, archived: { at: at(3) } }])
    )
    await act(() => h.answer(summary))
    await wait(() => page.root.textContent == next, 'the archived one leaves')
    assertEquals(history(h.asked), [])
    assertEquals(summaries(h.asked), [summary])
    assertEquals(h.dropped.includes(summary), false)
  } finally {
    page.free()
  }
  assertEquals(h.held(), [])
  assertEquals(h.errors, [])
})

test('a person’s inbox asks its summary and the rows it draws, never their neighborhood', async () => {
  let actor = id(), target = id()
  let g = await shop([
    { entity: { eid: actor }, person: {}, doc: { title: 'Owner' } },
    {
      entity: { eid: target },
      task: {},
      filed: { assignee: actor },
      doc: { title: 'Complete title' },
    },
  ])
  let h = host({ read: (l) => g.read(l) })
  let page = mount(
    <h.Door e={{ entity: { eid: actor }, person: {} }} view='Inbox' />,
  )
  try {
    await wait(
      () => texts(page.root, '.Tile_Title').includes('Complete title'),
      'a populated title',
    )
    assertEquals(h.asked.some((l) => l.includes(`.refs=${actor}`)), false)
    assertEquals(history(h.asked), [])
    assertEquals(summaries(h.asked), [summaryQuery(actor)])
    assertEquals(h.asked.length, 2)
  } finally {
    page.free()
  }
})
