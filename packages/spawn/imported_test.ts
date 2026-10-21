// Importing provider metadata records history and owes no managed/native turn.
// Adapter and launch counters keep this regression entirely in memory.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { fileOf } from '@yaks/file'
import { spawning } from './effects.ts'
import { asked, start } from './run.ts'
import { asking, fake, tracked } from './testing.ts'

let { g, fx } = tracked()
let delivered = 0, native = 0, argv = 0, launched = 0
let opts = {
  adapters: {
    fake: {
      ...fake,
      argv: () => {
        argv++
        throw new Error('unexpected adapter call')
      },
    },
  },
  launch: () => {
    launched++
    throw new Error('unexpected launch')
  },
}
let handlers = spawning(opts)({ graph: g })
fx.handle({
  spawn_start: (...args) => {
    delivered++
    return handlers.spawn_start(...args)
  },
  session_run: () => {
    native++
  },
})
let rows: Bundle[] = asking(
  'imported-session',
  'imported-selection',
  'old input',
)
let source = rows.at(-1)!
source.lines = { file: fileOf('disk', 'logs/rollout.jsonl'), start: 1 }
source.notice = {}
await g.apply(rows, { trusted: true })
await fx.idle()
let metadataRequest = await asked(g, 'imported-session')
let metadataRun = await start(g, 'imported-session', opts)
// An already owed effect from before the declaration was narrowed stays passive.
await g.storage.tx((tx) =>
  handlers.spawn_start(
    {
      kind: 'created',
      name: 'using',
      entity: source.entity,
    },
    tx,
    (rows) => g.apply(rows),
  )
)
let metadata = { delivered, native, argv, launched }
// Historical selections never steal a later, explicit managed request.
let nextGraph = tracked().g
await nextGraph.apply(rows, { trusted: true })
let request = asking('imported-session', 'new-request', 'new work').at(-1)!
await nextGraph.apply([request])
let next = await asked(nextGraph, 'imported-session')
let servedGraph = tracked().g
let served: Bundle[] = asking(
  'served-session',
  'served-selection',
  'served output',
)
served.at(-1)!.ask = {}
await servedGraph.apply(served, { trusted: true })
let servedRequest = await asked(servedGraph, 'served-session')

test('imported CLI provider metadata never starts adapters or owes model turns', () => {
  assertEquals(metadataRequest, null)
  assertEquals(metadataRun, null)
  assertEquals(metadata, { delivered: 0, native: 0, argv: 0, launched: 0 })
})

test('managed request selection skips imported selections and served asks', () => {
  assertEquals(next?.instruction, 'new work')
  assertEquals((next?.ask as Comp)?.through, 'new-request')
  assertEquals(servedRequest, null)
})
