import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Reply } from '@yaks/model'
import { sessionTools } from '@yaks/session'
import { agent, seed } from './run.ts'
import { open } from './store.ts'

let reply = (text: string): Reply => ({
  id: 'r',
  model: 'fake',
  items: [{ kind: 'assistant', text }],
})
let until = async (test: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 1000; i++) {
    if (await test()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error('pool failed to progress')
}
Deno.test('shared FIFO pool admits IDs before preparation and never over-admits across parents', async () => {
  let h = open(':memory:')
  let starts: string[] = [], prepared: string[] = []
  let replies = Array.from({ length: 3 }, () => Promise.withResolvers<Reply>())
  let tools = sessionTools(h.g, {
    maxChildren: 1,
    prepareChild: async ({ child }) => {
      prepared.push(child)
      return {}
    },
  })
  let a = agent({
    h,
    tools,
    model: (req) => {
      let text = req.items.find((i) => i.kind == 'user') as { text: string }
      starts.push(text.text)
      return replies[Number(text.text)].promise
    },
  })
  await h.g.apply([
    ...seed(),
    ...['p', 'q'].map((id) => ({ entity: { eid: id }, session: { id } })),
  ])
  await h.g.apply(
    [0, 1, 2].map((i) => ({
      entity: { eid: 'call' + i },
      entry: { session: i % 2 ? 'q' : 'p', seq: i + 1 },
      notice: {},
      call: {},
    })),
  )
  let spawn = tools.find((t) => t.name == 'spawn')!
  let ids = await Promise.all(
    [0, 1, 2].map((i) =>
      spawn.run({ prompt: String(i), model: 'fake' }, {
        session: i % 2 ? 'q' : 'p',
        call: { entity: { eid: 'call' + i } },
        entries: [],
      })
    ),
  )
  await new Promise((r) => setTimeout(r, 100))
  await until(() => starts.length == 1)
  assertEquals(ids.length, 3)
  assertEquals(prepared.length, 1)
  assertEquals((await h.g.read('.dispatch.state=queued')).length, 2)
  assertEquals((await h.g.read('.session.status=queued')).length, 2)
  for (let i = 0; i < 3; i++) {
    replies[i].resolve(reply('done'))
    if (i < 2) await until(() => starts.length == i + 2)
  }
  await until(async () =>
    (await h.g.read('.dispatch.state=settled')).length == 3
  )
  assertEquals(starts, ['0', '1', '2'])
  await a.close()
})
Deno.test('queued intent survives daemon restart and stop does not drain durable queue', async () => {
  let h = open(':memory:')
  let tools = sessionTools(h.g, { maxChildren: 0 })
  let a = agent({
    h,
    tools,
    model: () => {
      throw new Error('queued child ran')
    },
  })
  await h.g.apply([{ entity: { eid: 'p' }, session: {} }])
  await h.g.apply([{
    entity: { eid: 'call' },
    entry: { session: 'p', seq: 1 },
    notice: {},
    call: {},
  }])
  let id = String(
    await tools.find((t) => t.name == 'spawn')!.run({
      prompt: 'work',
      model: 'fake',
    }, { session: 'p', call: { entity: { eid: 'call' } }, entries: [] }),
  )
  await a.d.stop()
  assertEquals((await h.g.read('.dispatch.state=queued')).length, 1)
  let b = agent({
    h,
    tools: sessionTools(h.g, { maxChildren: 1 }),
    model: () => Promise.resolve(reply('done')),
  })
  await until(async () =>
    (await h.g.read('.dispatch.state=settled')).length == 1
  )
  assertEquals((await b.children('p'))[0].entity.eid, id)
  assertEquals(((await b.children('p'))[0].dispatch as Comp).args, null)
  await b.close()
})
Deno.test('cap one nested delegated wait releases and reacquires its slot', async () => {
  let h = open(':memory:')
  let turns = new Map<string, number>()
  let finished = false
  let a = agent({
    h,
    maxChildren: 1,
    model: (req) => {
      let name = (req.items.find((i) =>
        i.kind == 'user'
      ) as { text: string }).text
      let n = turns.get(name) ?? 0
      turns.set(name, n + 1)
      let call = (tool: string, args: unknown): Reply => ({
        id: 'r',
        model: 'fake',
        items: [{
          kind: 'call',
          name: tool,
          id: tool + name,
          args: JSON.stringify(args),
        }],
      })
      if (name == 'parent' && n == 0) {
        return Promise.resolve(call('spawn', { prompt: 'nested' }))
      }
      if (name == 'nested' && n == 0) {
        return Promise.resolve(call('spawn', { prompt: 'leaf' }))
      }
      if (name == 'nested' && n == 1) {
        let result = req.items.find((i) => i.kind == 'result') as unknown as {
          text: string
        }
        return Promise.resolve(
          call('wait', { children: [result.text], timeout: 5000 }),
        )
      }
      if (name == 'nested') finished = true
      return Promise.resolve(reply('done'))
    },
  })
  await a.start('parent')
  await until(() => finished)
  assertEquals(turns.get('leaf'), 1)
  await a.close()
})
Deno.test('queued cancellation skips expensive prep; prep failure has one terminal receipt', async () => {
  let h = open(':memory:')
  let prepared: string[] = []
  let tools = sessionTools(h.g, {
    maxChildren: 0,
    prepareChild: async ({ child }) => {
      prepared.push(child)
      throw new Error('checkout failed')
    },
  })
  let a = agent({ h, tools, model: () => Promise.resolve(reply('parent')) })
  await h.g.apply([
    { entity: { eid: 'p' }, session: {} },
    ...['cancel', 'fail'].map((id, i) => ({
      entity: { eid: id },
      entry: { session: 'p', seq: i + 1 },
      notice: {},
      call: {},
    })),
  ])
  let spawn = tools.find((t) => t.name == 'spawn')!
  for (let id of ['cancel', 'fail']) {
    await spawn.run({ prompt: id, model: 'fake' }, {
      session: 'p',
      call: { entity: { eid: id } },
      entries: [],
    })
  }
  await h.g.apply([{
    entity: { eid: 'stop-cancel' },
    entry: { session: 'child:cancel', seq: 2 },
    stop: {},
  }])
  sessionTools(h.g, { maxChildren: 1 })
  a.d.wake('child:fail')
  await until(async () =>
    (await h.g.read('.dispatch.state=settled')).length == 2
  )
  await a.d.idle('child:fail')
  await a.d.idle('p')
  assertEquals(prepared, ['child:fail'])
  assertEquals(
    (await h.g.read('.entry.session=p')).filter((b) =>
      b.entity.eid.startsWith('delivery:child:fail:')
    ).length,
    1,
  )
  await a.close()
})
