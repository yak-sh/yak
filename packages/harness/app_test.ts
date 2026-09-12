import { frontend } from './frontend.ts'
import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Bundle, Comp } from '@yaks/graph'
import type { Model } from '@yaks/model'
import { mount } from '../tui/harness.ts'
import { App, changes } from './app.ts'
import { panels, type UIAgent } from './panels.ts'
import { agent } from './run.ts'
import { open } from './store.ts'
import { until } from '../process/harness.ts'

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
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
    children: (parent) =>
      Promise.resolve(sessions.filter((b) => b.session.parent == parent)),
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
    entry: (b) =>
      h('span', null, String((b.content as Comp | undefined)?.body ?? '')),
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
    let ansi = ui.out.join('')
    assert(ansi.includes('38;2;167;192;128mmessage'))
    assert(ansi.includes('38;2;230;152;117;1mTasks'))
    assert(ansi.includes('38;2;122;132;120;2m╭'))
    await ui.send('\t')
    assert(ui.out.join('').includes('38;2;230;152;117mtask'))
    await ui.send('\t')
    let before = reads
    // Composer growth reallocates bounded sidebar panels as well as the thumb.
    assert((await ui.send('ab\x1b[13;2ucd\x1b[D!')) <= 40)
    assertEquals(reads, before) // typing does not query the graph
    assert(ui.text().includes('c!d'))
    await ui.send('\x0e') // begin a slow s1 read
    await ui.send('X')
    assert(ui.text().includes('X')) // a separate draft while the graph read is blocked
    await ui.send('\x7f')
    await ui.send('\x0e') // switch to s2 before s1 answers
    stale.resolve([{ entity: { eid: 'old' }, content: { body: 'STALE' } }])
    await settle()
    assert(ui.text().includes('transcript s2'))
    assert(!ui.text().includes('STALE'))
    assert(ui.text().includes('● s3')) // child panel
    await ui.send('\x0f\x0e\x0e\x0e') // four selector keys in one read
    await settle()
    assert(ui.text().includes('Harness — s3'))
    await ui.send('\x1b[1;3A') // alt up
    await settle()
    assert(ui.text().includes('Harness — s2'))
    await ui.send('\x1b[A?') // ordinary up still edits after switching transcripts
    assert(ui.text().includes('?')) // this session has its own draft
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
    await ui.send(
      'ping\x1b[13;2u**second line**\x1b[13;2u\x1b[13;2uthird paragraph\r',
    )
    await settle()
    let s = await until(
      async () => (await a.sessions())[0],
      'root checkout preparation',
    )
    let entries = await a.transcript(s.entity.eid)
    assertEquals(
      (entries.find((b) => !b.prompt && b.content)!.content as Comp).body,
      'ping\n**second line**\n\nthird paragraph',
    )
    await until(
      () => ui.text().includes('third paragraph'),
      'multiline transcript paint',
    )
    let rows = ui.text().split('\n')
    // The sidebar names the session after its first prompt, so 'ping' appears
    // there too. Read only the columns left of the sidebar heading.
    let edge = rows[0].indexOf('Sessions')
    assert(edge > 0, ui.text())
    let pane = (row: string) => row.slice(0, edge)
    let first = rows.findIndex((row) => pane(row).includes('ping'))
    let second = rows.findIndex((row) => pane(row).includes('second line'))
    let third = rows.findIndex((row) => pane(row).includes('third paragraph'))
    assert(first >= 0, ui.text())
    assertEquals(second, first + 1, ui.text())
    assertEquals(third, second + 2, ui.text())
    reply.resolve({
      id: 'r1',
      model: 'fake',
      items: [{ kind: 'assistant', text: 'pong' }],
    })
    await a.idle(s.entity.eid)
    await settle() // deliberately no ui.send()
    assert(ui.text().includes('pong'))
    assert(ui.text().includes('pong'))
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
    reply.resolve({ id: 'cleanup', model: 'fake', items: [] })
    ui.free()
    await a.close()
  }
})

Deno.test('two submissions before start resolves stay ordered in one new session', async () => {
  let started = deferred<string>()
  let starts: string[] = [], sends: string[] = []
  let a: UIAgent = {
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
    children: () => Promise.resolve([]),
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: (b) =>
      h('span', null, String((b.content as Comp | undefined)?.body ?? '')),
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
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
    children: () => Promise.resolve([]),
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: (b) =>
      h('span', null, String((b.content as Comp | undefined)?.body ?? '')),
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

Deno.test('Tab preserves editing and captures message/task mode for each queued submit', async () => {
  let started = deferred<string>()
  let writes: string[] = []
  let a: UIAgent = {
    children: () => Promise.resolve([]),
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: (b) =>
      h('span', null, String((b.content as Comp | undefined)?.body ?? '')),
    line: () => '',
    start: (text) => {
      writes.push(`start: ${text}`)
      return started.promise
    },
    send: (id, text) => {
      writes.push(`message ${id}: ${text}`)
      return Promise.resolve('input')
    },
    taskEntry: (id, text) => {
      writes.push(`task ${id}: ${text}`)
      return Promise.resolve({ task: 'task', child: 'child' })
    },
  }
  let ui = await mount(
    () => h(App, { agent: a, subscribe: () => () => {} }),
    120,
    40,
  )
  try {
    assert(ui.text().includes('message · Esc NORMAL'))
    await ui.send('\tno parent\r')
    await settle()
    assert(ui.text().includes('Select a session'))
    assertEquals(writes, [])
    await ui.send('\t\x15')
    await ui.send('start\rfirst\t\x1b[13;2usecond\r\tmessage\r\t\ttail\r')
    started.resolve('parent')
    await settle()
    assertEquals(writes, [
      'start: start',
      'task parent: first\nsecond',
      'message parent: message',
      'message parent: tail',
    ])
    assert(ui.text().includes('message · Esc NORMAL'))
    assert(ui.text().includes('Harness — parent')) // do not select the child
  } finally {
    ui.free()
  }
})

Deno.test('task mode paints claimed work and subagent, then its delivered result without keys', async () => {
  let childReply = deferred<Awaited<ReturnType<Model>>>()
  let childAsked = deferred<void>()
  let a = agent({
    h: open(':memory:'),
    tools: [],
    model: (req) => {
      if (
        req.items.some((i) =>
          i.kind == 'user' && i.text.startsWith('microtask')
        )
      ) {
        childAsked.resolve()
        return childReply.promise
      }
      return Promise.resolve({
        id: 'r',
        model: 'fake',
        items: [{ kind: 'assistant', text: 'parent ready' }],
      })
    },
  })
  let ui = await mount(
    () => h(App, { agent: a, subscribe: changes(a) }),
    120,
    40,
  )
  try {
    await ui.send('parent\r')
    await settle()
    let parent = await until(
      async () => (await a.sessions())[0],
      'root checkout preparation',
    )
    await a.idle(parent.entity.eid)
    await ui.send('\tmicrotask\x1b[13;2udetails\r')
    await childAsked.promise
    await settle()
    let [task] = await a.tasks()
    let [child] = await a.children(parent.entity.eid)
    assertEquals((task.claim as Comp).session, child.entity.eid)
    assert(ui.text().includes('microtask'), ui.text())
    assert(
      ui.text().includes(child.entity.eid.replace(/^child:/, '').slice(0, 8)),
      ui.text(),
    )
    assert(ui.text().includes(`Harness — ${parent.entity.eid.slice(0, 8)}`))
    await a.h.g.apply([{ entity: task.entity, completed: {} }])
    childReply.resolve({
      id: 'r',
      model: 'fake',
      items: [{ kind: 'assistant', text: 'microtask final' }],
    })
    await a.idle(child.entity.eid)
    await a.idle(parent.entity.eid)
    await settle() // no keys after the submit
    assert(ui.text().includes('microtask final'), ui.text())
    assert(ui.text().includes('done'), ui.text())
  } finally {
    ui.free()
    await a.close()
  }
})

Deno.test('composer spans the bottom below transcript and responsive sidebar', async () => {
  let a: UIAgent = {
    start: () => Promise.resolve('s'),
    send: () => Promise.resolve('e'),
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: () => h('span', null, 'entry'),
    line: () => '',
  }
  for (let width of [90, 150, 200, 80]) {
    let ui = await mount(
      () =>
        h(App, {
          agent: a,
          subscribe: () => () => {},
          panels: [{
            title: 'Sidebar',
            read: () => Promise.resolve([]),
            Render: () => h('div', null, 'side content'),
          }],
        }),
      width,
      12,
    )
    try {
      await settle()
      // Longer than the transcript column, but short enough for the full width.
      let draft = 'x'.repeat(width - 8)
      await ui.send(draft)
      let lines = ui.text().split('\n')
      assertEquals(lines.length, 12)
      assert(lines[10].includes(draft), ui.text())
      assert(lines[9].includes('message · Esc NORMAL'), ui.text())
      assertEquals(ui.text().includes('Sidebar'), width >= 90)
      if (width >= 90) {
        assertEquals(
          lines.find((line) => line.includes('Sidebar'))!.indexOf('Sidebar'),
          width - Math.max(30, Math.floor(width * 0.2)),
        )
      }
      assertEquals(lines[11].length, width)
      await ui.send('\x1b[13;2usecond line')
      lines = ui.text().split('\n')
      assert(lines[8].includes('message · Esc NORMAL'), ui.text())
      assert(lines[9].includes(draft), ui.text())
      assert(lines[10].includes('second line'), ui.text())
      assert(lines[11].startsWith('╰'), ui.text())
    } finally {
      ui.free()
    }
  }
})

Deno.test('completed subagents hide but unfinished settled workers stay visible', async () => {
  let sessions: Bundle[] = [
    { entity: { eid: 'parent' }, session: { id: 'ROOT', status: 'settled' } },
    {
      entity: { eid: 'child' },
      session: { id: 'DONE_CHILD', status: 'settled', tasksCompleted: true },
      spawned: { parent: 'parent' },
    },
    {
      entity: { eid: 'active' },
      session: { id: 'ACTIVE_CHILD', status: 'running' },
      spawned: { parent: 'parent' },
    },
    {
      entity: { eid: 'unfinished' },
      session: { id: 'QUIET_WORKER', status: 'settled', tasksCompleted: false },
      spawned: { parent: 'parent' },
    },
  ]
  let a: UIAgent = {
    sessions: () => Promise.resolve(sessions),
    children: () => Promise.resolve(sessions.slice(1)),
    tasks: () => Promise.resolve([]),
    transcript: (id) =>
      Promise.resolve([{
        entity: { eid: 'entry' },
        content: {
          body: id == 'parent'
            ? 'parent retains child result'
            : 'child transcript intact',
        },
      }]),
    entry: (b) => h('span', null, String((b.content as Comp).body)),
    line: () => '',
    start: () => Promise.resolve('parent'),
    send: () => Promise.resolve('input'),
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
  }
  let ui = await mount(
    () => h(App, { agent: a, subscribe: () => () => {} }),
    120,
    40,
  )
  try {
    await settle()
    assert(ui.text().includes('ROOT'))
    assert(ui.text().includes('ACTIVE_CHILD'))
    assert(ui.text().includes('QUIET_WORKER'))
    assert(!ui.text().includes('DONE_CHILD'))
    assert(!ui.text().includes('Keys'))
    await ui.send('\x0e')
    await settle()
    assert(ui.text().includes('parent retains child result'))
    assert(!ui.text().includes('DONE_CHILD'))
    await ui.send('\x1b[106;5u') // next visible row is the active child
    await settle()
    assert(ui.text().includes('● ACTIVE_CHILD'))
    await ui.send('\x13')
    assert(ui.text().includes('DONE_CHILD'))
    assert(ui.text().includes('DONE_CHILD'))
    await ui.send('\x1b[107;5u') // now the settled child is selectable
    await settle()
    assert(ui.text().includes('● DONE_CHILD'))
    assert(ui.text().includes('child transcript intact'))
    await ui.send('\x13') // selected child remains even with filter on
    assert(ui.text().includes('● DONE_CHILD'))
    await ui.send('\x1b[107;5u') // previous visual row is the root
    await settle()
    assert(ui.text().includes('parent retains child result'))
    assert(!ui.text().includes('DONE_CHILD'))
    assertEquals(sessions.length, 4)
  } finally {
    ui.free()
  }
})

Deno.test('tree navigation skips children between roots and archive toggles stay in graph state', async () => {
  let sessions: Bundle[] = [
    { entity: { eid: 'a' }, session: { id: 'ROOT_A', status: 'settled' } },
    {
      entity: { eid: 'child' },
      session: { id: 'WORKER', title: 'Research widgets', status: 'running' },
      spawned: { parent: 'a' },
    },
    { entity: { eid: 'b' }, session: { id: 'ROOT_B', status: 'settled' } },
  ]
  let state = frontend()
  let a: UIAgent = {
    sessions: () => Promise.resolve(sessions),
    children: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: () => h('span', null),
    line: () => '',
    start: () => Promise.resolve('a'),
    send: () => Promise.resolve('input'),
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    archive: (id, archived) => {
      let row = sessions.find((b) => b.entity.eid == id)!
      if (archived) row.archived = {}
      else delete row.archived
      return Promise.resolve()
    },
  }
  let ui = await mount(
    () => h(App, { agent: a, subscribe: () => () => {}, frontend: state }),
    130,
    40,
  )
  let selected = () => (state.client.ent('view')!.frontend as Comp).selected
  try {
    await settle()
    await ui.send('\x0e')
    await settle()
    assertEquals(selected(), 'a')
    await ui.send('\x1b[106;5u')
    assert(ui.text().includes('Research widgets'), ui.text())
    await settle()
    assertEquals(selected(), 'child')
    await ui.send('\x0e')
    await settle()
    assertEquals(selected(), 'b')
    await ui.send('\x10')
    await settle()
    assertEquals(selected(), 'a')
    await ui.send('\x1ba')
    await settle()
    assert(!ui.text().includes('ROOT_A'))
    assert(sessions[0].archived)
    assertEquals((sessions[1].session as Comp).status, 'running')
    await ui.send('\x1bz')
    assert(ui.text().includes('ROOT_A'))
    await ui.send('\x0e')
    await settle()
    await ui.send('\x1ba')
    await settle()
    assertEquals(sessions[0].archived, undefined)
    await ui.send('hjkl') // never steal plain vim letters from the editor
    assertEquals((state.client.ent('draft')!.draft as Comp).text, 'hjkl')
  } finally {
    ui.free()
    state.close()
  }
})

Deno.test('session return preserves detached anchors through loading; Ctrl+End follows again', async () => {
  let f = frontend()
  let sessions = ['a', 'b'].map((id) => ({
    entity: { eid: id },
    session: { id, status: 'settled' },
  }))
  let entries = (id: string) =>
    Array.from(
      { length: 100 },
      (_, i) => ({
        entity: { eid: id + i },
        content: { body: id + '-line-' + i },
      }),
    )
  let waiting: ReturnType<typeof deferred<Bundle[]>> | undefined
  let a: UIAgent = {
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    sessions: () => Promise.resolve(sessions),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: (id) =>
      waiting && id == 'a' ? waiting.promise : Promise.resolve(entries(id)),
    entry: (b) => h('div', null, String((b.content as Comp).body)),
    line: (b) => String((b.content as Comp).body),
    start: () => Promise.resolve('a'),
    send: () => Promise.resolve('input'),
  }
  let ui = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    70,
    14,
  )
  try {
    await ui.send('\x0e')
    await settle()
    assert(ui.text().includes('a-line-99'), ui.text())
    await ui.send('\x1b[5~')
    let saved = { ...f.client.ent('viewport-a')!.viewport as Comp }
    assertEquals(saved.follow, false)
    await ui.send('\x0e')
    waiting = deferred<Bundle[]>()
    await ui.send('\x10')
    await settle()
    assertEquals(f.client.ent('viewport-a')!.viewport, saved)
    waiting.resolve(entries('a'))
    await settle()
    assertEquals(f.client.ent('viewport-a')!.viewport, saved)
    await ui.send('draft\x1b[1;5F')
    assertEquals((f.client.ent('viewport-a')!.viewport as Comp).follow, true)
    assert(ui.text().includes('a-line-99'), ui.text())
    assertEquals((f.client.ent('draft')!.draft as Comp).text, 'draft')
    waiting = undefined
    await ui.send('\x0e\x10')
    await settle()
    assertEquals((f.client.ent('viewport-a')!.viewport as Comp).follow, true)
    assert(ui.text().includes('a-line-99'), ui.text())
  } finally {
    ui.free()
    f.close()
  }
})

Deno.test('large open tree reserves room for all sidebar headings and reveals selected rows', async () => {
  let f = frontend()
  let sessions: Bundle[] = [
    { entity: { eid: 'root' }, session: { status: 'settled', title: 'ROOT' } },
    ...Array.from(
      { length: 80 },
      (_, i) => ({
        entity: { eid: 'child-' + i },
        session: { status: 'pending', title: 'Worker-' + i },
        spawned: { parent: 'root' },
      }),
    ),
  ]
  f.patch({ selected: 'root' })
  let a: UIAgent = {
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    sessions: () => Promise.resolve(sessions),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: () => null,
    line: () => '',
    start: () => Promise.resolve('root'),
    send: () => Promise.resolve('input'),
  }
  let ui = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    120,
    32,
  )
  try {
    await settle()
    for (let p of panels) assert(ui.text().includes(p.title), ui.text())
    f.patch({ selected: 'child-79' })
    await settle()
    assert(ui.text().includes('Worker-79'), ui.text())
    for (let p of panels) assert(ui.text().includes(p.title), ui.text())
  } finally {
    ui.free()
    f.close()
  }
})

Deno.test('transcript publishes before slow sidebar reads and despite ongoing changes', async () => {
  let reply = deferred<Awaited<ReturnType<Model>>>()
  let sidebar = deferred<Bundle[]>()
  let dir = await Deno.makeTempDir()
  let a = agent({
    h: open(':memory:'),
    cwd: dir,
    model: () => reply.promise,
    tools: [],
  })
  let state = frontend()
  let id = await a.start('visible before response')
  state.patch({ selected: id })
  let ui = await mount(
    () =>
      h(App, {
        agent: a,
        frontend: state,
        subscribe: changes(a),
        panels: [{
          title: 'Slow',
          read: () => sidebar.promise,
          Render: () => h('span', null, 'sidebar'),
        }],
      }),
    100,
    30,
  )
  try {
    await until(
      () => ui.text().includes('visible before response'),
      'input paint while panel and model pending',
    )
    let existing = await a.transcript(id)
    await a.h.g.apply([{
      entity: { eid: 'second-input' },
      entry: {
        session: id,
        seq: Number((existing.at(-1)!.entry as Comp).seq) + 1,
      },
      content: { body: 'second committed input' },
    }])
    await until(
      () => ui.text().includes('second committed input'),
      'subsequent input paint while panel pending',
    )
    assert(!ui.text().includes('pong'))
  } finally {
    sidebar.resolve([])
    reply.resolve({
      id: 'r',
      model: 'fake',
      items: [{ kind: 'assistant', text: 'pong' }],
    })
    await a.idle(id)
    ui.free()
    state.close()
    a.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('Ctrl directions navigate visual rows and spatial focus; legacy Enter and Backspace edit', async () => {
  let rows: Bundle[] = [
    { entity: { eid: 'root' }, session: { id: 'Root', status: 'running' } },
    {
      entity: { eid: 'a' },
      session: { id: 'First', status: 'running' },
      spawned: { parent: 'root' },
    },
    {
      entity: { eid: 'aa' },
      session: { id: 'Grandchild', status: 'running' },
      spawned: { parent: 'a' },
    },
    {
      entity: { eid: 'b' },
      session: { id: 'Second', status: 'running' },
      spawned: { parent: 'root' },
    },
    {
      entity: { eid: 'other' },
      session: { id: 'OtherRoot', status: 'running' },
    },
  ]
  let f = frontend(), sent: string[] = []
  let a: UIAgent = {
    sessions: () => Promise.resolve(rows),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    entry: () => null,
    line: () => '',
    start: () => Promise.resolve('root'),
    send: (_id, text) => {
      sent.push(text)
      return Promise.resolve('input')
    },
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
  }
  let ui = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    120,
    40,
  )
  let selected = () => (f.client.ent('view')!.frontend as Comp).selected
  let key = async (code: number) => {
    await ui.send('\x1b[' + code + ';5u')
    await settle()
  }
  try {
    await settle()
    f.patch({ selected: 'root' })
    await settle()
    assert(ui.text().includes('Grandchild'))
    assert(!ui.text().includes('▸'))
    assert(!ui.text().includes('▾'))
    await key(108)
    assertEquals(selected(), 'root')
    assertEquals((f.client.ent('keyboard')!.keyboard as Comp).focus, 'sidebar')
    await key(106)
    assertEquals(selected(), 'a')
    await key(106)
    assertEquals(selected(), 'aa')
    await key(106)
    assertEquals(selected(), 'b')
    await key(107)
    assertEquals(selected(), 'aa')
    await key(104)
    assertEquals(selected(), 'aa')
    assertEquals(
      (f.client.ent('keyboard')!.keyboard as Comp).focus,
      'transcript',
    )
    await ui.send('xy\x08')
    assertEquals((f.client.ent('draft')!.draft as Comp).text, 'x')
    await ui.send('\n')
    await settle()
    assertEquals(sent, ['x'])
    assertEquals(selected(), 'aa')
    await ui.send('preserve')
    await key(107)
    assertEquals((f.client.ent('draft')!.draft as Comp).text, '')
    f.patch({ selected: 'aa' })
    assertEquals((f.client.ent('draft')!.draft as Comp).text, 'preserve')
    assert(
      ui.out.join('').includes('48;2;52;63;68'),
      'selected background reaches ANSI',
    )
  } finally {
    ui.free()
    f.close()
  }
})

Deno.test('sidebar selectable contributions follow visual order and archive only selected session', async () => {
  const f = frontend()
  const sessions: Bundle[] = [
    { entity: { eid: 'root' }, session: { id: 'Root', status: 'running' } },
    {
      entity: { eid: 'child' },
      session: { id: 'Child', status: 'running' },
      spawned: { parent: 'root', call: null },
    },
  ]
  const task: Bundle = {
    entity: { eid: 'task' },
    task: {},
    doc: { title: 'Selectable task' },
    claim: { session: 'child' },
  }
  const archived: string[] = []
  const a: UIAgent = {
    sessions: () => Promise.resolve(sessions),
    children: () => Promise.resolve([]),
    tasks: () => Promise.resolve([task]),
    transcript: () => Promise.resolve([]),
    entry: () => null,
    line: () => '',
    start: () => Promise.resolve('root'),
    send: () => Promise.resolve('input'),
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
    archive: (id, value) => {
      archived.push(id)
      sessions.find((b) => b.entity.eid == id)!.archived = value
        ? {}
        : undefined
      return Promise.resolve()
    },
  }
  const ui = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    120,
    40,
  )
  const cursor = () => (f.client.ent('view')!.frontend as Comp).sidebar
  try {
    await settle()
    await ui.send('\x1bl') // legacy unrelated key stays editing; use NORMAL below
    await ui.send('\x1b')
    await ui.send('l')
    await ui.send('j')
    await settle()
    assertEquals(cursor(), 'root')
    await ui.send('j')
    await settle()
    assertEquals(cursor(), 'child')
    await ui.send('j')
    await settle()
    assertEquals(cursor(), 'task')
    assert(ui.text().includes('Selectable task'))
    await ui.send('k')
    await settle()
    assertEquals(cursor(), 'child')
    await ui.send('a')
    await settle()
    assertEquals(archived, ['child'])
    assertEquals(sessions[0].archived, undefined)
  } finally {
    ui.free()
    f.close()
  }
})

Deno.test('mouse clicks select sessions, new session and task rows without changing drafts', async () => {
  const f = frontend()
  const sessions: Bundle[] = ['s1', 's2'].map((id) => ({
    entity: { eid: id },
    session: { id, title: id, status: 'settled' },
  }))
  const a: UIAgent = {
    sessions: () => Promise.resolve(sessions),
    tasks: () =>
      Promise.resolve([{
        entity: { eid: 't1' },
        task: {},
        doc: { title: 'click task' },
        claim: { session: 's2' },
      }]),
    children: () => Promise.resolve([]),
    transcript: () => Promise.resolve([]),
    start: () => Promise.resolve('created'),
    send: () => Promise.resolve('sent'),
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
    line: () => '',
    entry: () => null,
  }
  const ui = await mount(
    () =>
      h(App, {
        agent: a,
        frontend: f,
        subscribe: () => () => {},
      }),
    120,
    40,
  )
  const click = async (label: string) => {
    const lines = ui.text().split('\n')
    const y = lines.findIndex((line) => line.includes(label))
    assert(y >= 0, ui.text())
    const x = lines[y].indexOf(label)
    await ui.send(
      '\x1b[<0;' + (x + 1) + ';' + (y + 1) + 'M' +
        '\x1b[<0;' + (x + 1) + ';' + (y + 1) + 'm',
    )
    await settle()
  }
  try {
    await settle()
    await ui.send('unsent')
    await click('s1')
    assertEquals((f.client.ent('view')?.frontend as Comp)?.selected, 's1')
    assertEquals((f.client.ent('keyboard')?.keyboard as Comp)?.focus, 'sidebar')
    await click('click task')
    assertEquals((f.client.ent('view')?.frontend as Comp)?.selected, 's2')
    assertEquals((f.client.ent('view')?.frontend as Comp)?.sidebar, 't1')
    await click('New session')
    assertEquals((f.client.ent('view')?.frontend as Comp)?.selected, null)
    assertEquals((f.client.ent('draft')?.draft as Comp)?.text, 'unsent')
  } finally {
    ui.free()
    await f.close()
  }
})
