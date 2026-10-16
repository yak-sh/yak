import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { claude } from '@yaks/claude'
import { agent } from './agent.ts'
import { harness } from './testing.ts'

test('Claude CLI model turns, calls and results use the native transcript loop', async () => {
  let h = await harness()
  let executed = 0
  let a = agent({
    h,
    provider: 'claude',
    name: 'haiku',
    release: () => h.close(),
    providers: {
      claude: claude({
        command: Deno.execPath(),
        args: [
          'run',
          '-A',
          new URL('../claude/fake_cli.ts', import.meta.url).pathname,
        ],
      }),
    },
    tools: [{
      name: 'graph_query',
      description: 'Read graph',
      parameters: { type: 'object', properties: { q: { type: 'string' } } },
      run: (args) => {
        executed++
        assertEquals(args, { q: 'hello' })
        return Promise.resolve('found')
      },
    }],
  })
  try {
    let s = await a.start('work')
    await a.idle(s)
    let rows = await a.transcript(s)
    assertEquals(executed, 1)
    assertEquals(rows.filter((b) => b.ask).length, 2)
    assertEquals(rows.filter((b) => b.call).length, 1)
    assertEquals(rows.filter((b) => b.result).length, 1)
    assertEquals(rows.filter((b) => b.output && b.content).length, 2)
    assertEquals(rows.filter((b) => b.claude).length, 2)
    assertEquals((await h.g.get([s]))[0].native, {})
  } finally {
    await a.close()
  }
})
