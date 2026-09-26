import { assertEquals } from '@std/assert'
import type { Comp } from '@yaks/graph'
import type { Reply } from '@yaks/model'
import { type ChildLimits, sessionTools } from '@yaks/session'
import { seed } from './agent.ts'
import { local } from './local.ts'
import type { Harness } from './store.ts'
import { harness, repo } from './testing.ts'

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
// A graph in a file of its own, for a test that closes it and opens it again:
// what a restart finds is what the file kept.
let file = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'pool-reopen-' })
  return {
    path: dir + '/graph.sqlite',
    free: () => Deno.remove(dir, { recursive: true }),
  }
}
// The same limits bound the tools that queue children and the runner that
// admits them.
let limited = (h: Harness, limits: ChildLimits) => ({
  ...limits,
  tools: sessionTools(h.g, limits),
})

Deno.test('shared FIFO pool admits IDs before preparation and never over-admits across parents', async () => {
  let h = await harness()
  let starts: string[] = [], prepared: string[] = []
  let replies = Array.from({ length: 3 }, () => Promise.withResolvers<Reply>())
  let bound = limited(h, {
    maxChildren: 1,
    prepareChild: ({ child }) => {
      prepared.push(child)
      return Promise.resolve({})
    },
  })
  let a = local({
    cwd: repo(),
    h,
    ...bound,
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
  let spawn = bound.tools.find((t) => t.name == 'spawn')!
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
  assertEquals((await h.g.read('.dispatch.state=queued&*')).length, 2)
  assertEquals((await h.g.read('.session.status=queued&*')).length, 2)
  for (let i = 0; i < 3; i++) {
    replies[i].resolve(reply('done'))
    if (i < 2) await until(() => starts.length == i + 2)
  }
  await until(async () =>
    (await h.g.read('.dispatch.state=settled&*')).length == 3
  )
  assertEquals(starts, ['0', '1', '2'])
  await a.close()
})

Deno.test('queued intent survives a restart, and closing does not drain the durable queue', async () => {
  let { path, free } = await file()
  let h = await harness(path)
  let bound = limited(h, { maxChildren: 0 })
  let a = local({
    cwd: repo(),
    h,
    ...bound,
    model: () => {
      throw new Error('queued child ran')
    },
  })
  let b: ReturnType<typeof local> | undefined
  try {
    await h.g.apply([{ entity: { eid: 'p' }, session: {} }])
    await h.g.apply([{
      entity: { eid: 'call' },
      entry: { session: 'p', seq: 1 },
      notice: {},
      call: {},
    }])
    let id = String(
      await bound.tools.find((t) => t.name == 'spawn')!.run({
        prompt: 'work',
        model: 'fake',
      }, { session: 'p', call: { entity: { eid: 'call' } }, entries: [] }),
    )
    await a.close()
    h = await harness(path)
    assertEquals((await h.g.read('.dispatch.state=queued&*')).length, 1)
    b = local({
      cwd: repo(),
      h,
      ...limited(h, { maxChildren: 1 }),
      model: () => Promise.resolve(reply('done')),
    })
    await until(async () =>
      (await h.g.read('.dispatch.state=settled&*')).length == 1
    )
    assertEquals((await b.children('p'))[0].entity.eid, id)
    assertEquals(((await b.children('p'))[0].dispatch as Comp).args, null)
  } finally {
    await a.close()
    await b?.close()
    await free()
  }
})

Deno.test('cap one nested delegated wait releases and reacquires its slot', async () => {
  let h = await harness()
  let turns = new Map<string, number>()
  let finished = false
  let a = local({
    cwd: repo(),
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
          output: string
        }
        return Promise.resolve(
          call('wait', {
            children: [result.output.split('\n')[0]],
            timeout: 5000,
          }),
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
  let { path, free } = await file()
  let h = await harness(path)
  let prepared: string[] = []
  let prepare: ChildLimits['prepareChild'] = ({ child }) => {
    prepared.push(child)
    return Promise.reject(new Error('checkout failed'))
  }
  let bound = limited(h, { maxChildren: 0, prepareChild: prepare })
  let a = local({
    cwd: repo(),
    h,
    ...bound,
    model: () => Promise.resolve(reply('parent')),
  })
  let b: ReturnType<typeof local> | undefined
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: {} },
      ...['cancel', 'fail'].map((id, i) => ({
        entity: { eid: id },
        entry: { session: 'p', seq: i + 1 },
        notice: {},
        call: {},
      })),
    ])
    let spawn = bound.tools.find((t) => t.name == 'spawn')!
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
    await a.close()
    h = await harness(path)
    b = local({
      cwd: repo(),
      h,
      ...limited(h, { maxChildren: 1, prepareChild: prepare }),
      model: () => Promise.resolve(reply('parent')),
    })
    await until(async () =>
      (await h.g.read('.dispatch.state=settled&*')).length == 2
    )
    await b.idle('child:fail')
    await b.idle('p')
    assertEquals(prepared, ['child:fail'])
    assertEquals(
      (await h.g.read('.entry.session=p&*')).filter((b) =>
        b.entity.eid.startsWith('delivery:child:fail:')
      ).length,
      1,
    )
  } finally {
    await a.close()
    await b?.close()
    await free()
  }
})

Deno.test('queued submissions and fork anchors survive file reopen without duplicate preparation', async () => {
  let { path, free } = await file()
  let h = await harness(path)
  let bound = limited(h, { maxChildren: 0 })
  let a = local({
    cwd: repo(),
    h,
    ...bound,
    model: () => Promise.resolve(reply('done')),
  })
  try {
    await h.g.apply([{ entity: { eid: 'p' }, session: {} }, {
      entity: { eid: 'input' },
      entry: { session: 'p' },
      content: { body: 'original' },
    }, {
      entity: { eid: 'ask' },
      entry: { session: 'p' },
      ask: { through: 'input' },
    }, {
      entity: { eid: 'call' },
      entry: { session: 'p' },
      call: { id: 'call' },
    }])
    let entries = await a.transcript('p')
    let id = String(
      await bound.tools.find((t) => t.name == 'fork')!.run({
        prompt: 'child',
        model: 'fake',
      }, { session: 'p', call: { entity: { eid: 'call' } }, entries }),
    )
    await a.close()
    h = await harness(path)
    let prep = 0
    bound = limited(h, {
      maxChildren: 1,
      prepareChild: () => {
        prep++
        return Promise.resolve({})
      },
    })
    a = local({
      cwd: repo(),
      h,
      ...bound,
      model: () => Promise.resolve(reply('done')),
    })
    await until(async () =>
      (await h.g.read('.dispatch.state=settled&*')).length == 1
    )
    assertEquals(((await a.children('p'))[0].fork as Comp).from, 'input')
    assertEquals(
      String(
        await bound.tools.find((t) => t.name == 'fork')!.run({
          prompt: 'ignored',
        }, {
          session: 'p',
          call: { entity: { eid: 'call' } },
          entries,
        }),
      ),
      id,
    )
    assertEquals(prep, 1)
  } finally {
    await a.close()
    await free()
  }
})
