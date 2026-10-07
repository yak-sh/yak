import { archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { ddl, journal, log } from '@yaks/journal'
import { spineDoc } from '@yaks/kernel/vocab'
import { kernelKeywords } from '@yaks/kernel/vocab'
import { docs as archetypeDocs } from '@yaks/archetype/vocab'
import machineDoc from '../packages/machine/vocab.json' with { type: 'json' }
import { loadVocab } from '@yaks/vocab'
import { open } from '@yaks/sqlite/db'
import { drift, storage } from '@yaks/sqlite'
import { equal, test } from '@yaks/testing'
import {
  migratedMachine,
  resolveSessionHome,
} from '../packages/cli/session_home.ts'
import {
  contractHomes,
  expandHomes,
  processIdentity,
  undrained,
} from './migrate-session-machines.ts'

let fixture = () => {
  let db = open(':memory:')
  let vocab = loadVocab([spineDoc, ...archetypeDocs, machineDoc, {
    $defs: {
      home: {
        component: true,
        properties: {
          worktree: { type: 'string', ref: 'worktree', death: 'keep' },
          machine: { type: 'string', ref: 'machine', death: 'keep' },
          cwd: { type: 'string' },
        },
      },
      worktree: {
        component: true,
        properties: { path: { type: 'string' }, head: { type: 'string' } },
      },
      session: {
        component: true,
        properties: { status: { type: 'string' }, ended: { type: 'boolean' } },
      },
      gitobj: { component: true, properties: {} },
    },
  }], [kernelKeywords])
  let store = storage(db, vocab)
  store.install()
  for (let s of ddl()) db.query(s)
  let g = graph({
    storage: store,
    vocab,
    plugins: [archetypes(), journal(log({ rows: (s) => db.query(s) }))],
  })
  return { db, g }
}

test('session home expansion preserves in-flight checkout, command cwd and graph references', async () => {
  let { db, g } = fixture()
  try {
    await g.apply([
      { entity: { eid: 'head' }, gitobj: {} },
      {
        entity: { eid: 'tree' },
        worktree: { path: '/working/checkout', head: 'head' },
      },
      {
        entity: { eid: 'active' },
        session: { status: 'running' },
        home: { worktree: 'tree', cwd: '/working/checkout/sub' },
      },
      {
        entity: { eid: 'settled' },
        session: { status: 'settled' },
        home: { worktree: 'tree' },
      },
    ])
    equal(expandHomes(g, db), {
      homes: 2,
      moved: 2,
      running: 1,
      released: 1,
      fallback: 0,
    })
    let [active, machine, settledMachine] = await g.get([
      'active',
      migratedMachine('active'),
      migratedMachine('settled'),
    ])
    equal(active.home, {
      worktree: 'tree',
      machine: migratedMachine('active'),
      cwd: '/working/checkout/sub',
    })
    equal(machine.machine, {
      provider: 'process',
      address: '/working/checkout',
      from: 'head',
      image: null,
      state: 'running',
    })
    equal((settledMachine.machine as { state: string }).state, 'released')
    equal(expandHomes(g, db).moved, 0)
    equal(contractHomes(g), 2)
    equal(contractHomes(g), 0)
    let [now, tree] = await g.get(['active', 'tree'])
    equal((now.home as { worktree: unknown }).worktree, null)
    equal((tree.worktree as { path: string }).path, '/working/checkout')
    equal(drift(db).drifted, 0)
  } finally {
    db.close()
  }
})

test('host boundary attaches legacy checkout without consuming old worker source', async () => {
  let { db, g } = fixture()
  try {
    await g.apply([
      { entity: { eid: 'tree' }, worktree: { path: '/checkout' } },
      {
        entity: { eid: 's' },
        session: { status: 'running' },
        home: { worktree: 'tree', cwd: '/checkout/sub' },
      },
    ])
    let resolve = resolveSessionHome(db, () => g)
    equal(await resolve('s'), {
      machine: migratedMachine('s'),
      cwd: '/checkout/sub',
    })
    equal(await resolve('s'), {
      machine: migratedMachine('s'),
      cwd: '/checkout/sub',
    })
    let [row] = await g.get(['s'])
    equal((row.home as { worktree: string }).worktree, 'tree')
    equal(expandHomes(g, db).moved, 1)
    equal((await g.read('.machine')).length, 1)
  } finally {
    db.close()
  }
})

test('retired checkout uses explicit absolute cwd, not an unrelated host directory', async () => {
  let { db, g } = fixture()
  try {
    await g.apply([
      { entity: { eid: 'gone' }, worktree: { path: '/previous' } },
      {
        entity: { eid: 's' },
        home: { worktree: 'gone', cwd: '/old/specific' },
      },
    ])
    await g.apply([{ entity: { eid: 'bad' }, home: { worktree: 'gone' } }, {
      entity: { eid: 'peerless' },
      worktree: { path: '/temporary' },
    }, { entity: { eid: 'orphan' }, home: { worktree: 'peerless' } }])
    await g.apply([{ entity: { eid: 'gone' }, worktree: null }, {
      entity: { eid: 'peerless' },
      worktree: null,
    }])
    await g.apply([{ entity: { eid: 'orphan' }, home: { cwd: '/temporary' } }])
    equal(expandHomes(g, db).fallback, 3)
    let [machine] = await g.get([migratedMachine('s')])
    equal((machine.machine as { address: string }).address, '/old/specific')
    await g.apply([{
      entity: { eid: 'orphan' },
      home: { cwd: null, machine: null },
    }])
    let message = ''
    try {
      expandHomes(g, db)
    } catch (error) {
      message = (error as Error).message
    }
    equal(
      message,
      'Legacy session home has no checkout or absolute cwd: orphan',
    )
    let [bad] = await g.get(['orphan'])
    equal((bad.home as { machine: unknown }).machine, null)
  } finally {
    db.close()
  }
})

test('drain receipt refuses living generation and tolerates exited or reused PIDs', async () => {
  let start = await processIdentity(Deno.pid)
  equal(
    await undrained({
      db: 'copy',
      workers: [{ pid: Deno.pid, start: start! }],
    }),
    [Deno.pid],
  )
  equal(
    await undrained({
      db: 'copy',
      workers: [{ pid: Deno.pid, start: 'not-current-starttime' }],
    }),
    [],
  )
})

test('composed CLI host translates a pre-machine home before any provisioning', async () => {
  let { compose, facet } = await import('../packages/cli/host.ts')
  let { docs } = await import('../packages/harness/vocab.ts')
  let host = await compose(
    {
      db: ':memory:',
      plugins: [
        '@yaks/kernel',
        '@yaks/key',
        '@yaks/archetype',
        '@yaks/edge',
        '@yaks/git',
        '@yaks/process',
        '@yaks/session',
        '@yaks/machine',
        '@yaks/harness',
      ],
    },
    ['graph'],
    async (plugin, name) => {
      if (plugin == '@yaks/harness' && name == 'vocab') {
        let expanded = structuredClone(docs)
        for (let doc of expanded) {
          if (doc.$defs?.home) {
            doc.$defs.home.properties!.worktree = {
              type: 'string',
              ref: 'worktree',
              death: 'keep',
            }
          }
        }
        return { docs: expanded }
      }
      return await facet(plugin, name)
    },
    { process: false },
  )
  try {
    await host.graph.apply([
      {
        entity: { eid: 'legacy-tree' },
        worktree: { path: '/legacy/checkout' },
      },
      {
        entity: { eid: 'legacy-session' },
        session: {},
        home: { worktree: 'legacy-tree', cwd: '/legacy/checkout/sub' },
      },
    ])
    equal(await host.machines!.resolveHome!('legacy-session'), {
      machine: migratedMachine('legacy-session'),
      cwd: '/legacy/checkout/sub',
    })
    let [machine, session] = await host.graph.get([
      migratedMachine('legacy-session'),
      'legacy-session',
    ])
    equal((machine.machine as { address: string }).address, '/legacy/checkout')
    equal((session.home as { worktree: string }).worktree, 'legacy-tree')
  } finally {
    await host.close()
  }
})

test('ordinary CLI reads remain available before destination expansion', async () => {
  let { compose, facet } = await import('../packages/cli/host.ts')
  let { docs } = await import('../packages/harness/vocab.ts')
  let dir = await Deno.makeTempDir()
  let config = {
    db: dir + '/graph.db',
    plugins: [
      '@yaks/kernel',
      '@yaks/key',
      '@yaks/archetype',
      '@yaks/edge',
      '@yaks/git',
      '@yaks/process',
      '@yaks/session',
      '@yaks/harness',
    ],
  }
  let old = await compose(config, ['graph'], async (plugin, name) => {
    if (plugin == '@yaks/harness' && name == 'vocab') {
      let legacy = structuredClone(docs)
      for (let doc of legacy) {
        if (doc.$defs?.home) {
          delete doc.$defs.home.properties!.machine
          doc.$defs.home.properties!.worktree = {
            type: 'string',
            ref: 'worktree',
            death: 'keep',
          }
        }
      }
      return { docs: legacy }
    }
    return await facet(plugin, name)
  }, { install: true, process: false })
  try {
    await old.graph.apply([
      { entity: { eid: 'checkout' }, worktree: { path: '/kept/checkout' } },
      {
        entity: { eid: 'still-working' },
        session: {},
        home: { worktree: 'checkout', cwd: '/kept/checkout/sub' },
      },
    ])
    await old.close()
    let next = await compose(config, ['graph'], undefined, { process: false })
    try {
      let [session] = await next.graph.get(['still-working'])
      equal((session.home as { cwd: string }).cwd, '/kept/checkout/sub')
      equal((session.home as { machine: unknown }).machine ?? null, null)
      equal((await next.graph.read('.session&.home&*')).length, 1)
    } finally {
      await next.close()
    }
  } finally {
    await old.close()
    await Deno.remove(dir, { recursive: true })
  }
})
