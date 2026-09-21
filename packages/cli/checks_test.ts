// The doctor, end to end — and it is not a registry. A host composes its
// plugins, and every tool whose verb is `check` IS the doctor
// (@yaks/tools `checks`): add a plugin and its checks arrive, drop it and they
// go, and no list anywhere can fall out of date.
//
// So this composes a real host over a real file, makes two impossible states
// real — a lock held by a transcript that stopped, a board whose query no
// longer routes — and asks every check the host has. Each one is called the
// way any caller calls a tool: a `call` entity through the runner, and the
// prose it answered read back off the result.

import { assert, assertEquals } from '@std/assert'
import { answerOf, checks, toolEid, worded } from '@yaks/tools'
import type { Bundle } from '@yaks/graph'
import { compose, type Served } from './serve.ts'

// The harness plugin speaks the session, project, task and doc words and
// carries their runs; @yaks/sqlite adds the two checks that can only be asked
// of the file.
let host = () =>
  compose({
    db: ':memory:',
    plugins: ['@yaks/harness', '@yaks/sqlite'],
    // A person reads these reports and types the ids back, so this host is
    // one that opts into the human number line.
    numbers: true,
  })

// One check, asked the way a door asks: write the call, run it, read the prose.
let ask = async (h: Served, name: string): Promise<string> => {
  await h.runner.ensure()
  let landed = await h.runner.call([{
    entity: { eid: `$${name}` },
    call: { to: toolEid(name), args: '{}' },
  }]) as Bundle[]
  return worded(answerOf(landed))
}

Deno.test('the checks are the tools whose verb is check', async () => {
  let h = await host()
  try {
    let named = checks(h.tools).map((t) => t.name).sort()
    assertEquals(named, [
      'archetype_check',
      'board_check',
      'claim_check',
      'project_check',
      'session_check',
      'storage_check',
    ])
    // Nothing registered them: they are declarations the composed vocabulary
    // carries, so the list is the composition.
    assert(h.tools.length > named.length)
  } finally {
    h.close()
  }
})

Deno.test('a composed host finds exactly the two states we broke', async () => {
  let h = await host()
  try {
    // A project, a task filed under it, and a transcript that has stopped
    // while still holding the task.
    await h.graph.apply([
      { entity: { eid: 'p1' }, project: {}, doc: { title: 'Tasks v2' } },
      { entity: { eid: 't1' }, task: {}, doc: { title: 'Ship it' } },
      { entity: { eid: 't1' }, filed: { project: 'p1' } },
      { entity: { eid: 's1' }, session: { id: 'one' } },
      {
        entity: { eid: 'e1' },
        entry: { session: 's1', seq: 1 },
        content: { body: 'go' },
      },
      { entity: { eid: 'e2' }, entry: { session: 's1', seq: 2 }, stop: {} },
      { entity: { eid: 't1' }, claim: { session: 's1' } },
    ])
    // A board written PAST the graph, which is how one stops routing: the
    // board guard refuses this query at the door, and another host's writer
    // never asked the door.
    h.storage.tx((tx) =>
      tx.patch([{
        entity: { eid: 'b1' },
        doc: { title: 'Everything open' },
        board: { query: '.staus=open' },
      }])
    )

    let claim = await ask(h, 'claim_check')
    assert(claim.includes('T-3 is locked by S-4'), claim)
    assert(claim.includes('whose transcript stopped'), claim)

    let board = await ask(h, 'board_check')
    // The numbers start at 2, not 1: this PROCESS is an entity too, and its
    // row is the first thing composing the host writes.
    assert(board.includes('B-7 no longer routes'), board)
    assert(board.includes('.staus=open'), board)

    // And the checks nothing broke still answer, rather than staying silent.
    assertEquals(
      await ask(h, 'project_check'),
      'every governed entity is reachable from a project — nothing to report',
    )
    assert(
      (await ask(h, 'storage_check')).endsWith('— nothing to report'),
      await ask(h, 'storage_check'),
    )
    // One that cannot run says so: this host composes no archetype plugin.
    assert(
      (await ask(h, 'archetype_check')).includes('keeps no archetypes'),
      await ask(h, 'archetype_check'),
    )
  } finally {
    h.close()
  }
})
