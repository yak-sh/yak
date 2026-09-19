import { assertEquals, assertRejects } from '@std/assert'
import { type Comp, graph, type Plugin, type Tool } from '@yaks/graph'
import { runner, UnfinishedCall } from '@yaks/tools'
import { open } from './store.ts'

// The claim is durable, so a call that ran once is answered from the graph
// after a reopen rather than run a second time — and a claim with no answer
// stays a claim until somebody re-drives it.
Deno.test('recorded execution survives SQLite reopen and needs no session', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'call-execution-' })
  const path = dir + '/test.db'
  let h = open(path)
  let runs = 0
  const echo: Tool = {
    eid: 'tool',
    name: 'echo',
    description: 'say hello',
    run: (_bundles, ctx) => {
      runs++
      return [{
        entity: { eid: '$said' },
        content: { body: 'hello' },
        output: { source: ctx.call },
      }]
    },
  }
  try {
    await h.g.apply([
      { entity: { eid: 'tool' }, tool: { name: 'echo' } },
      { entity: { eid: 'call' }, call: { to: 'tool', args: '{}' } },
      {
        entity: { eid: 'unfinished' },
        call: { to: 'tool' },
        execution: { state: 'running' },
      },
    ])
    await runner(h.g, { tools: [echo] }).run('call')
    h.close()
    h = open(path)
    const again = runner(h.g, { tools: [echo] })
    const result = await again.run('call')
    assertEquals(runs, 1)
    assertEquals(result.find((b) => b.entry), undefined)
    assertEquals(result.find((b) => b.output)?.content, { body: 'hello' })
    await assertRejects(() => again.run('unfinished'), UnfinishedCall)
    assertEquals(runs, 1)
  } finally {
    h.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('failed result commit leaves the claim and never repeats side effects', async () => {
  const h = open(':memory:')
  const rejectResult: Plugin = {
    name: 'reject-results',
    hooks: {
      precondition: (bundles) => {
        if (bundles.some((b) => b.result)) {
          throw new Error('storage unavailable')
        }
        return bundles
      },
    },
  }
  const g = graph({
    vocab: h.g.vocab,
    storage: h.g.storage,
    plugins: [rejectResult],
  })
  let runs = 0
  try {
    await g.apply([
      { entity: { eid: 'tool' }, tool: { name: 'echo' } },
      { entity: { eid: 'call' }, call: { to: 'tool', args: '{}' } },
    ])
    const r = runner(g, {
      tools: [{
        eid: 'tool',
        name: 'echo',
        description: 'do the irreversible thing',
        run: () => {
          runs++
          return [{ entity: { eid: '$said' }, content: { body: 'done' } }]
        },
      }],
    })
    await assertRejects(() => r.run('call'), Error, 'storage unavailable')
    assertEquals(
      ((await g.read('.execution'))[0].execution as Comp).state,
      'running',
    )
    assertEquals(await g.read('.result'), [])
    await assertRejects(() => r.run('call'), UnfinishedCall)
    assertEquals(runs, 1)
  } finally {
    h.close()
  }
})
