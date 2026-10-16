import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { claude } from '@yaks/claude'
import { agent } from './agent.ts'
import { harness } from './testing.ts'

// Drive an independent real CLI/harness session at load; close it before
// budgeted assertions observe its immutable public transcript outcome.
let nativeLoop = await (async () => {
  let h = await harness()
  let executed = 0
  let received: unknown[] = []
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
        received.push(structuredClone(args))
        return Promise.resolve('found')
      },
    }],
  })
  try {
    let s = await a.start('work')
    await a.idle(s)
    let rows = await a.transcript(s)
    return Object.freeze({
      executed,
      received: JSON.stringify(received),
      turns: rows.filter((b) => b.ask).length,
      calls: rows.filter((b) => b.call).length,
      results: rows.filter((b) => b.result).length,
      outputs: rows.filter((b) => b.output && b.content).length,
      claude: rows.filter((b) => b.claude).length,
      native: JSON.stringify((await h.g.get([s]))[0].native),
    })
  } finally {
    await a.close()
  }
})()

test('Claude CLI model turns, calls and results use the native transcript loop', () => {
  assertEquals(nativeLoop.executed, 1)
  assertEquals(nativeLoop.received, '[{"q":"hello"}]')
  assertEquals(nativeLoop.turns >= 2 && nativeLoop.turns <= 3, true)
  assertEquals(nativeLoop.calls, 1)
  assertEquals(nativeLoop.results, 1)
  assertEquals(nativeLoop.outputs, nativeLoop.turns)
  assertEquals(nativeLoop.claude, nativeLoop.turns)
  assertEquals(nativeLoop.native, '{}')
})
