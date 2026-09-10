import { assert, assertEquals } from '@std/assert'
import { remote } from './remote.ts'
Deno.test('worker owns an isolated database; selected entries replicate and commands stay explicit', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({ db: ':memory:', cwd: dir, fake: true })
  try {
    let id = await r.agent.start('worker test')
    let entries = await r.agent.transcript(id)
    assert(
      entries.some((b) =>
        (b.content as { body?: string })?.body == 'worker test'
      ),
    )
    for (let i = 0; i < 100; i++) {
      entries = await r.agent.transcript(id)
      if (entries.some((b) => (b.content as { body?: string })?.body == 'ok')) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert(entries.some((b) => (b.content as { body?: string })?.body == 'ok'))
    let second = await r.agent.start('other')
    await r.agent.transcript(second)
    await r.agent.transcript(id)
    assertEquals((await r.agent.sessions()).length, 2)
    await r.agent.archive!(id, true)
    assert((await r.agent.sessions()).find((b) => b.entity.eid == id)?.archived)
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('worker rejects bad paths without creating a fallback database', async () => {
  const { assertRejects } = await import('@std/assert')
  let dir = await Deno.makeTempDir()
  try {
    await assertRejects(() => remote({ db: dir, fake: true }))
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('worker stop waits for admitted commands and model turns', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({ db: ':memory:', cwd: dir, fake: true })
  try {
    let work = r.agent.start('finish before shutdown')
    await r.close()
    await work
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('worker frontend typing stays local after its subscribed view is ready', async () => {
  const { h } = await import('preact')
  const { App } = await import('./app.ts')
  const { frontend } = await import('./frontend.ts')
  const { mount } = await import('../tui/harness.ts')
  let dir = await Deno.makeTempDir()
  let r = await remote({ db: ':memory:', cwd: dir, fake: true })
  let local = frontend()
  let screen: Awaited<ReturnType<typeof mount>> | undefined
  try {
    let id = await r.agent.start('selected')
    await r.idle(id)
    local.patch({ selected: id })
    screen = await mount(
      () => h(App, { agent: r.agent, subscribe: r.subscribe, frontend: local }),
      100,
      24,
    )
    for (let i = 0; i < 100 && !screen.text().includes('selected'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert(screen.text().includes('selected'))
    let sent = r.traffic.sent
    await screen.send('draft stays here')
    assertEquals(r.traffic.sent, sent)
    assertEquals(
      (local.client.ent('draft')!.draft as { text: string }).text,
      'draft stays here',
    )
  } finally {
    screen?.free()
    local.close()
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('worker subscribes only to selected fork ancestry, respecting each boundary', async () => {
  const { open } = await import('./store.ts')
  let dir = await Deno.makeTempDir(), path = dir + '/test.db'
  let store = open(path)
  await store.g.apply([
    { entity: { eid: 'root' }, session: { id: 'root' } },
    {
      entity: { eid: 'a' },
      entry: { session: 'root', seq: 1 },
      content: { body: 'inherited' },
    },
    {
      entity: { eid: 'b' },
      entry: { session: 'root', seq: 2 },
      content: { body: 'excluded' },
    },
    { entity: { eid: 'child' }, session: { id: 'child' }, fork: { from: 'a' } },
    {
      entity: { eid: 'c' },
      entry: { session: 'child', seq: 3 },
      content: { body: 'local' },
    },
    { entity: { eid: 'other' }, session: { id: 'other' } },
    {
      entity: { eid: 'd' },
      entry: { session: 'other', seq: 1 },
      content: { body: 'unrelated' },
    },
  ], { trusted: true })
  store.close()
  let r = await remote({ db: path, cwd: dir, fake: true })
  try {
    assertEquals((await r.agent.transcript('child')).map((b) => b.entity.eid), [
      'a',
      'c',
    ])
    assertEquals(r.replica.ent('b'), undefined)
    assertEquals(r.replica.ent('d'), undefined)
    assertEquals((await r.agent.transcript('other')).map((b) => b.entity.eid), [
      'd',
    ])
    assert(!r.replica.ent('a')?.entry)
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('worker publishes a second input while a slow model is still pending', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({ db: ':memory:', cwd: dir, fake: { delayMs: 500 } })
  try {
    let id = await r.agent.start('first')
    // Ensure replication is watching before admitting the next message.
    await r.agent.transcript(id)
    await r.agent.send(id, 'second before reply')
    let entries = await r.agent.transcript(id)
    assert(
      entries.some((b) =>
        (b.content as { body?: string })?.body == 'second before reply'
      ),
    )
    assert(
      !entries.some((b) => b.ask),
      'send must not wait for provider completion',
    )
    await r.idle(id)
    entries = await r.agent.transcript(id)
    assert(entries.some((b) => b.ask))
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('worker exit drains a burst and is idempotent', async () => {
  let dir = await Deno.makeTempDir()
  let r = await remote({ db: ':memory:', cwd: dir, fake: true })
  try {
    let id = await r.agent.start('burst')
    let writes = Array.from(
      { length: 25 },
      (_, i) => r.agent.send(id, 'x'.repeat(10000) + i),
    )
    let closing = r.close()
    assertEquals(r.close(), closing)
    await Promise.all(writes)
    assertEquals(await closing, { drained: true })
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('stuck model deadline is an expected bounded exit, not a crash', async () => {
  let dir = await Deno.makeTempDir()
  let db = dir + '/shutdown.db'
  let r = await remote({ db, cwd: dir, fake: 'stuck' })
  try {
    await r.agent.start('stuck')
    // Let the admitted turn enter the model callback.
    await new Promise((resolve) => setTimeout(resolve, 100))
    let start = performance.now()
    assertEquals(await r.close(), { drained: false })
    assert(performance.now() - start < 4000)
    let resumed = await remote({ db, cwd: dir, fake: true })
    try {
      await resumed.resume()
      let sessions = await resumed.agent.sessions()
      assertEquals(sessions.length, 1)
      let id = sessions[0].entity.eid
      await resumed.idle(id)
      assert(
        (await resumed.agent.transcript(id)).some((b) =>
          (b.content as { body?: string })?.body == 'ok'
        ),
      )
    } finally {
      await resumed.close()
    }
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})
