// Restoration keeps historical values while using the same write pipeline:
// the command schema admits the flag, guards refuse stale writes, and remote
// commands never acquire the local filesystem door's authority.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type Bundle, graph, signed } from '@yaks/graph'
import { books, comp, memory } from '../graph/testing.ts'
import { restoreInto } from './local.ts'
import { restorable } from './restore.ts'
import { cli, type Command } from './run.ts'

let historical = {
  at: '2026-10-09T12:00:00.000Z',
  by: 'then',
  via: 'instrument',
}
let now = '2026-10-11T12:00:00.000Z'
let fixture = () => {
  let journal: Bundle[] = []
  let storage = memory()
  storage.tx((tx) =>
    tx.patch(['then', 'instrument', 'caller'].map((eid) => ({
      entity: { eid },
      doc: { title: eid },
    })))
  )
  let g = graph({
    vocab: books,
    storage,
    clock: () => now,
    plugins: [{
      name: 'record',
      hooks: { journal: (bs) => (journal.push(...bs), bs) },
    }],
  })
  let ordinary = 0
  let command: Command = {
    name: 'graph_apply',
    noun: 'graph',
    verb: 'apply',
    description: 'Apply bundles',
    inputSchema: {
      type: 'object',
      properties: {
        bundles: { type: 'array' },
        check: { type: 'boolean' },
      },
      required: ['bundles'],
    },
    run: async (args) => {
      ordinary++
      await g.apply(signed(args.bundles as Bundle[], { by: 'caller' }), {
        check: args.check === true,
      })
      return 0
    },
  }
  let line = (flags: string[], bundles: Bundle[], remote = false) =>
    cli([restorable(command, async (args) => {
      await restoreInto(
        g,
        args.bundles as Bundle[],
        { by: 'caller' },
        args.check === true,
      )
      return 0
    })], {
      argv: [
        'graph',
        'apply',
        '--bundles',
        JSON.stringify(bundles),
        ...remote ? ['--host', 'example.test'] : ['--config', 'local.json'],
        ...flags,
      ],
      env: () => undefined,
      out: () => {},
      note: () => {},
    })
  return { g, journal, line, ordinary: () => ordinary }
}
let patch = (eid: string): Bundle[] => [{
  entity: { eid },
  doc: { title: 'Sale' },
  sold: historical,
  $actor: { by: 'then' },
}]

// Compile the shared vocabulary's rules before the timed cases.
fixture().g.apply(patch('warm'))

test('ordinary graph apply drops supplied server-owned history', async () => {
  let { g, line, ordinary } = fixture()
  assertEquals(await line([], patch('sale')), 0)
  assertEquals(ordinary(), 1)
  let [sale] = await g.get(['sale'])
  assertEquals(comp(sale, 'sold'), {})
  assertEquals(comp(sale, 'created'), { at: now, by: 'caller' })
})

test('local restore preserves history and stamps its current journal writer', async () => {
  let { g, journal, line, ordinary } = fixture()
  assertEquals(await line(['--restore'], patch('sale')), 0)
  assertEquals(ordinary(), 0)
  let [sale] = await g.get(['sale'])
  assertEquals(comp(sale, 'sold'), historical)
  assertEquals(comp(sale, 'created'), { at: now, by: 'caller' })
  assert(
    journal.some((b) => b.entity.eid == 'sale' && b.$actor?.by == 'caller'),
  )
})

test('a checked restoration rolls its changes back', async () => {
  let { g, line } = fixture()
  assertEquals(await line(['--restore', '--check'], patch('sale')), 0)
  assertEquals(await g.get(['sale']), [])
})

test('restoration refuses a stale guard', async () => {
  let { g, line } = fixture()
  assertEquals(
    await line(['--restore'], [{
      ...patch('sale')[0],
      $was: { sold: { at: 'stale' } },
    }]),
    1,
  )
  assertEquals(await g.get(['sale']), [])
})

test('a remote graph apply refuses restoration before calling the tool', async () => {
  let { g, line, ordinary } = fixture()
  assertEquals(await line(['--restore'], patch('sale'), true), 2)
  assertEquals(ordinary(), 0)
  assertEquals(await g.get(['sale']), [])
})
