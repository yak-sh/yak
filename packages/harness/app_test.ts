import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Bundle, Comp } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { mount } from '../tui/harness.ts'
import { App, changes } from './app.ts'
import { panels, type UIAgent } from './panels.ts'
import { agent } from './run.ts'
import { open } from './store.ts'

let settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}
let deferred = <T>() => {
  let resolve!: (v: T) => void
  let promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

Deno.test('fake agent: panels, burst selector keys, editing and stale reads', async () => {
  let listener = () => {}
  let reads = 0, freed = false
  let stale = deferred<Bundle[]>()
  let sessions = ['s1', 's2', 's3'].map((id) => ({
    entity: { eid: id },
    session: { id, status: 'settled', parent: id == 's3' ? 's2' : undefined },
  }))
  let a: UIAgent = {
    sessions: () => {
      reads++
      return Promise.resolve(sessions)
    },
    tasks: () =>
      Promise.resolve([{
        entity: { eid: 't1' },
        task: { status: 'open' },
        doc: { title: 'test task' },
      }]),
    transcript: (s) =>
      s == 's1' ? stale.promise : Promise.resolve([{
        entity: { eid: s },
        content: { body: `transcript ${s}` },
      }]),
    line: (b) => String((b.content as Comp).body),
    start: () => Promise.resolve('new'),
    send: () => Promise.resolve('input'),
  }
  let ui = await mount(
    () =>
      h(App, {
        agent: a,
        subscribe: (fn) => {
          listener = fn
          return () => {
            freed = true
          }
        },
      }),
    120,
    40,
  )
  try {
    await settle()
    for (let p of panels) assert(ui.text().includes(p.title), p.title)
    assert(ui.text().includes('test task'))
    let before = reads
    assertEquals(await ui.send('ab\x1b[13;2ucd\x1b[D!'), 2)
    assertEquals(reads, before) // typing does not query the graph
    assert(ui.text().includes('c!d'))
    await ui.send('\x0e') // begin a slow s1 read
    await ui.send('X')
    assert(ui.text().includes('c!Xd')) // the graph read is still blocked
    await ui.send('\x7f')
    await ui.send('\x0e') // switch to s2 before s1 answers
    stale.resolve([{ entity: { eid: 'old' }, content: { body: 'STALE' } }])
    await settle()
    assert(ui.text().includes('transcript s2'))
    assert(!ui.text().includes('STALE'))
    assert(ui.text().includes('s3  settled')) // child panel
    await ui.send('\x0f\x0e\x0e\x0e') // four selector keys in one read
    await settle()
    assert(ui.text().includes('Harness — s3'))
    await ui.send('\x1b[1;3A') // alt up
    await settle()
    assert(ui.text().includes('Harness — s2'))
    await ui.send('\x1b[A?') // ordinary up still edits after switching transcripts
    assert(ui.text().includes('ab?'))
    listener()
    await settle()
    assert(reads > before)
  } finally {
    ui.free()
  }
  assert(freed)
})

Deno.test('graph effects paint a model reply without a keypress; sends are input bundles', async () => {
  let reply = deferred<Awaited<ReturnType<Model>>>()
  let a = agent({ h: open(':memory:'), model: () => reply.promise, tools: [] })
  let subscribe = changes(a)
  let ui = await mount(() => h(App, { agent: a, subscribe }), 120, 40)
  try {
    await ui.send('ping\x1b[13;2usecond line\r')
    await settle()
    let [s] = await a.sessions()
    let entries = await a.transcript(s.entity.eid)
    assertEquals((entries[0].content as Comp).body, 'ping\nsecond line')
    assert(ui.text().includes('second line'), ui.text())
    reply.resolve({
      id: 'r1',
      model: 'fake',
      items: [{ kind: 'assistant', text: 'pong' }],
    })
    await a.idle(s.entity.eid)
    await settle() // deliberately no ui.send()
    assert(ui.text().includes('pong'))
    assert(ui.text().includes('settled'))
    await a.h.g.apply([{
      entity: { eid: 't1' },
      task: {},
      doc: { title: 'live task' },
    }])
    await settle()
    assert(ui.text().includes('live task'))
    await a.h.g.apply([{ entity: { eid: 't1' }, completed: {} }])
    await settle()
    assert(!ui.text().includes('live task'))
    await ui.send('again\r')
    await settle()
    await a.idle(s.entity.eid)
    assert(
      (await a.transcript(s.entity.eid)).some((b) =>
        (b.content as Comp | undefined)?.body == 'again' && !b.response
      ),
    )
  } finally {
    ui.free()
    a.close()
  }
})

Deno.test('two submissions before start resolves stay ordered in one new session', async () => {
  let started = deferred<string>()
  let starts: string[] = [], sends: string[] = []
  let a: UIAgent = {
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    line: () => '',
    start: (text) => {
      starts.push(text)
      return started.promise
    },
    send: (id, text) => {
      sends.push(`${id}: ${text}`)
      return Promise.resolve(text)
    },
  }
  let ui = await mount(
    () => h(App, { agent: a, subscribe: () => () => {} }),
    120,
    40,
  )
  try {
    await ui.send('one\rtwo\rthree\r')
    assertEquals(starts, ['one'])
    assertEquals(sends, [])
    await ui.send('\x0f') // the delayed start must not steal a newer selection
    started.resolve('s1')
    await settle()
    assertEquals(sends, ['s1: two', 's1: three'])
    assert(ui.text().includes('Harness — New session'))
  } finally {
    ui.free()
  }
})

Deno.test('a failed send is visible and contributed panels read and render bundles', async () => {
  let a: UIAgent = {
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    line: () => '',
    start: () => Promise.reject(new Error('offline')),
    send: () => Promise.reject(new Error('offline')),
  }
  let ui = await mount(
    () =>
      h(App, {
        agent: a,
        subscribe: () => () => {},
        panels: [{
          title: 'Contributed',
          read: () => [{
            entity: { eid: 'custom' },
            doc: { title: 'Custom bundle' },
          }],
          Render: ({ rows }) =>
            h(
              'div',
              null,
              String((rows[0]?.doc as Comp | undefined)?.title ?? ''),
            ),
        }],
      }),
    120,
    40,
  )
  try {
    await settle()
    assert(ui.text().includes('Contributed'))
    assert(ui.text().includes('Custom bundle'))
    await ui.send('keep this\r')
    await settle()
    assert(ui.text().includes('Not sent: keep this'))
    assert(ui.text().includes('offline'))
  } finally {
    ui.free()
  }
})
