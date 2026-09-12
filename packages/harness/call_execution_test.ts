import { assertEquals, assertRejects } from '@std/assert'
import { graph, type Plugin } from '@yaks/graph'
import { executeCall, UnfinishedCall } from '@yaks/tools'
import { open } from './store.ts'

Deno.test('recorded execution survives SQLite reopen and needs no session', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'call-execution-' })
  const path = dir + '/test.db'
  let h = open(path)
  let runs = 0
  const opts = {
    resolve: () => ({
      run: () => {
        runs++
        return 'hello'
      },
    }),
  }
  try {
    await h.g.apply([
      { entity: { eid: 'tool' }, tool: { name: 'echo' } },
      { entity: { eid: 'call' }, call: { to: 'tool', args: '{}' } },
      {
        entity: { eid: 'unfinished' },
        call: { to: 'tool' },
        execution: { state: 'started' },
      },
    ])
    await executeCall(h.g, 'call', opts)
    h.close()
    h = open(path)
    const result = await executeCall(h.g, 'call', opts)
    assertEquals(runs, 1)
    assertEquals(result[0].entry, undefined)
    assertEquals(result[0].content, { body: 'hello', source: null })
    await assertRejects(
      () => executeCall(h.g, 'unfinished', opts),
      UnfinishedCall,
    )
    assertEquals(runs, 1)
  } finally {
    h.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('failed result commit leaves started state and never repeats side effects', async () => {
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
    const options = {
      resolve: () => ({
        run: () => {
          runs++
          return 'effect completed'
        },
      }),
    }
    await assertRejects(
      () => executeCall(g, 'call', options),
      Error,
      'storage unavailable',
    )
    assertEquals((await g.read('.execution'))[0].execution, {
      state: 'started',
    })
    assertEquals(await g.read('.result'), [])
    await assertRejects(() => executeCall(g, 'call', options), UnfinishedCall)
    assertEquals(runs, 1)
  } finally {
    h.close()
  }
})
