// T-66423: explicitly move stored session homes without disturbing workers
// already using their worktrees. Run expand BEFORE restarting, then contract
// only after the recorded old processes have exited. Never run yak upgrade first.
//
// deno run -A bin/migrate-session-machines.ts --config /absolute/yak.json \
//   --phase expand --drain-file /tmp/T-66423-drain.json
// yak restart
// deno run -A bin/migrate-session-machines.ts --config /absolute/yak.json \
//   --phase contract --drain-file /tmp/T-66423-drain.json
//
// --phase all is a scratch-copy rehearsal (requires --scratch). It proves both
// phases and a second no-op run. The script loads vocabulary only: no services,
// provider provisioning, host composition or implicit schema installer runs.
import { archetypes } from '@yaks/archetype'
import { type Bundle, type Comp, graph, token } from '@yaks/graph'
import { journal, log } from '@yaks/journal'
import type { Driver } from '@yaks/sql'
import {
  columns,
  drift,
  grown,
  indexed,
  objects,
  storage,
  tabled,
} from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { read } from '../packages/cli/config.ts'
import { facet, type Load, words } from '../packages/cli/host.ts'
import { legacyHome, migratedMachine } from '../packages/cli/session_home.ts'
import { unit } from '../packages/sqlite/unit.ts'
import { stood } from '../packages/sqlite/physical.ts'
import machineDoc from '../packages/machine/vocab.json' with { type: 'json' }

let legacy = { type: 'string', ref: 'worktree', death: 'keep' }
let comp = (value: unknown): Comp => value as Comp ?? {}
let sync = <T>(value: T | Promise<T>): T => {
  if (value instanceof Promise) {
    throw new Error('Migration requires synchronous SQLite graph writes')
  }
  return value
}
let assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

/** Linux process identity, including its start time to distinguish PID reuse. */
export let processIdentity = async (
  pid: number,
): Promise<string | undefined> => {
  try {
    let stat = await Deno.readTextFile(`/proc/${pid}/stat`)
    let fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return fields[19]
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined
    throw error
  }
}
export type Drain = { db: string; workers: { pid: number; start: string }[] }
export let undrained = async (drain: Drain): Promise<number[]> => {
  let alive: number[] = []
  for (let worker of drain.workers) {
    if (await processIdentity(worker.pid) == worker.start) {
      alive.push(worker.pid)
    }
  }
  return alive
}

/** Build one attached machine for each old home. The source home column stays
 * nonempty during expansion so already-loaded code keeps seeing its checkout. */
export let expandHomes = (g: ReturnType<typeof graph>, db: Driver): {
  homes: number
  moved: number
  running: number
  released: number
  fallback: number
} => {
  let homes = sync(g.read('.home ?session'))
  let pending = homes.filter((row) => comp(row.home).worktree != null)
  let moved = 0, running = 0, released = 0, fallback = 0
  let patches: Bundle[] = []
  for (let row of pending) {
    let prior = comp(row.home)
    let attached = legacyHome(db, row.entity.eid)
    assert(
      attached,
      'Legacy home disappeared during migration: ' + row.entity.eid,
    )
    let [tree] = sync(g.get([String(prior.worktree)], ['worktree']))
    if (!comp(tree?.worktree).path) fallback++
    let ended = comp(row.session).ended === true
    let status = String(comp(row.session).status ?? '')
    let active = !ended && !['settled', 'stopped', 'failed'].includes(status)
    let machine = prior.machine ?? migratedMachine(row.entity.eid)
    let [held] = sync(g.get([String(machine)], ['machine']))
    if (held?.machine) {
      assert(
        comp(held.machine).provider == 'process' &&
          comp(held.machine).address == attached!.address,
        'Canonical machine disagrees with legacy home: ' + row.entity.eid,
      )
    } else {
      let [commit] = attached!.from
        ? sync(g.get([String(attached!.from)], ['gitobj']))
        : []
      patches.push({
        entity: { eid: String(machine) },
        machine: {
          provider: 'process',
          address: attached!.address,
          state: active ? 'running' : 'released',
          ...commit?.gitobj ? { from: attached!.from } : {},
        },
      })
      active ? running++ : released++
    }
    if (prior.machine == null) {
      patches.push({
        entity: row.entity,
        home: { machine, ...(prior.cwd == null ? { cwd: attached!.cwd } : {}) },
        $was: { home: { worktree: token(prior.worktree), machine: null } },
      })
      moved++
    }
  }
  if (patches.length) sync(g.apply(patches, { trusted: true }))
  let after = sync(g.read('.home'))
  assert(after.length == homes.length, 'Home count changed during expansion')
  for (let row of pending) {
    let [now] = sync(g.get([row.entity.eid], ['home']))
    let home = comp(now?.home)
    assert(
      home.worktree === comp(row.home).worktree && home.machine != null,
      'Expansion did not preserve both worker generations: ' + row.entity.eid,
    )
    if (comp(row.home).cwd != null) {
      assert(home.cwd === comp(row.home).cwd, 'cwd changed')
    }
  }
  return { homes: homes.length, moved, running, released, fallback }
}

/** Consume the source only once no old worker can ask for it. */
export let contractHomes = (g: ReturnType<typeof graph>): number => {
  let homes = sync(g.read('.home'))
  let old = homes.filter((row) => comp(row.home).worktree != null)
  let patches = old.map((row): Bundle => {
    let home = comp(row.home)
    assert(
      home.machine,
      'Refusing contraction before expansion: ' + row.entity.eid,
    )
    return {
      entity: row.entity,
      home: { worktree: null },
      $was: {
        home: { worktree: token(home.worktree), machine: token(home.machine) },
      },
    }
  })
  if (patches.length) sync(g.apply(patches, { trusted: true }))
  assert(
    sync(g.read('.home')).length == homes.length,
    'Home count changed during contraction',
  )
  assert(
    !sync(g.read('.home')).some((row) => comp(row.home).worktree != null),
    'Legacy homes remain',
  )
  return old.length
}

let options = () => {
  let out = { config: '', phase: '', drainFile: '', scratch: false }
  for (let i = 0; i < Deno.args.length; i++) {
    let key = Deno.args[i]
    if (key == '--scratch') {
      out.scratch = true
      continue
    }
    let value = Deno.args[++i]
    if (!value) throw new Error('Missing value for ' + key)
    if (key == '--config') out.config = value
    else if (key == '--phase') out.phase = value
    else if (key == '--drain-file') out.drainFile = value
    else throw new Error('Unknown option ' + key)
  }
  assert(
    out.config && ['expand', 'contract', 'all'].includes(out.phase),
    'Explicit --config and --phase expand|contract|all required',
  )
  assert(out.phase != 'all' || out.scratch, '--phase all requires --scratch')
  assert(out.scratch || out.drainFile, 'Live phases require --drain-file')
  return out
}

let run = async () => {
  let opts = options()
  let config = read(opts.config)
  assert(
    config.db && config.db != ':memory:',
    'Explicit file database required',
  )
  if (opts.scratch) {
    let own = `${Deno.env.get('HOME')}/.yak/yak.db`
    assert(
      await Deno.realPath(config.db!) != await Deno.realPath(own),
      '--scratch must not name the live graph',
    )
  }
  // Load only vocabulary. Temporarily admit the source so the graph can clear
  // it; the ordinary harness declaration contains only the canonical property.
  let load: Load = async (plugin, name) => {
    let module = await facet(plugin, name)
    if (plugin != '@yaks/harness' || name != 'vocab' || !module) return module
    let docs = structuredClone((module as { docs: VocabDoc[] }).docs)
    for (let doc of docs) {
      if (doc.$defs?.home) doc.$defs.home.properties!.worktree = legacy
    }
    return { ...module, docs } as Awaited<ReturnType<Load>>
  }
  let plugins = config.plugins ?? []
  if (
    !plugins.some((p) => (typeof p == 'string' ? p : p.use) == '@yaks/machine')
  ) {
    config = { ...config, plugins: [...plugins, '@yaks/machine'] }
  }
  let loaded = await words(config, load)
  let db = open(config.db!)
  try {
    let oldColumn = columns(db, 'home').includes('worktree')
    if (!oldColumn && opts.phase == 'expand') {
      console.log(
        JSON.stringify({
          phase: opts.phase,
          homes: 0,
          moved: 0,
          alreadyContracted: true,
        }),
      )
      return
    }
    // The final vocabulary must not resurrect an already-contracted source.
    if (!oldColumn) {
      for (let doc of loaded.docs) {
        if (doc.$defs?.home) delete doc.$defs.home.properties!.worktree
      }
      loaded.vocab = loadVocab(loaded.docs, loaded.vocab.keywords)
    }
    let store = storage(db, loaded.vocab, {
      derived: loaded.derived,
      backed: loaded.backed,
      number: config.numbers,
      schemaReady: () => true,
    })
    let g = graph({
      storage: store,
      vocab: loaded.vocab,
      plugins: [
        archetypes(),
        journal(
          log({ rows: (s) => db.query(s), derived: loaded.derived }),
          loaded.vocab,
        ),
      ],
    })
    let inventory = () =>
      sync(g.read('.worktree')).map((row) => JSON.stringify(row)).sort()
    let beforeTrees = inventory()
    let drain: Drain | undefined
    if (!opts.scratch && opts.phase == 'expand') {
      let workers = sync(g.read('.process !exit')).filter((row) => {
        let roles = comp(row.process).roles
        return Array.isArray(roles) && roles.length > 0
      })
      let captured: Drain['workers'] = []
      for (let row of workers) {
        let pid = Number(comp(row.process).pid)
        if (pid == Deno.pid || !pid) continue
        let start = await processIdentity(pid)
        if (start) captured.push({ pid, start })
      }
      drain = { db: await Deno.realPath(config.db!), workers: captured }
      try {
        let prior = JSON.parse(await Deno.readTextFile(opts.drainFile)) as Drain
        assert(
          prior.db == drain.db,
          'Existing drain receipt belongs to another graph',
        )
        let identities = new Map(
          prior.workers.map((
            worker,
          ) => [worker.pid + ':' + worker.start, worker]),
        )
        for (let worker of captured) {
          identities.set(worker.pid + ':' + worker.start, worker)
        }
        drain.workers = [...identities.values()]
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error
      }
      // Write the drain receipt first: an interrupted expansion never loses
      // which code generation can still depend on the source.
      await Deno.writeTextFile(
        opts.drainFile,
        JSON.stringify(drain, null, 2) + '\n',
      )
    }
    if (!opts.scratch && opts.phase == 'contract') {
      drain = JSON.parse(await Deno.readTextFile(opts.drainFile)) as Drain
      assert(
        drain.db == await Deno.realPath(config.db!),
        'Drain receipt belongs to another graph',
      )
      let alive = await undrained(drain)
      assert(
        !alive.length,
        'Old graph processes still in flight: ' + alive.join(', ') +
          '; repeat contract after they exit',
      )
    }
    let expansion: ReturnType<typeof expandHomes> | undefined
    let contracted = 0
    let second: ReturnType<typeof expandHomes> | undefined
    unit(db, () => {
      if (opts.phase != 'contract') {
        // Only this change's two additions: never a full-schema installer.
        let has = new Set(objects(db).map((row) => String(row.name)))
        for (
          let stmt of tabled(loadVocab([machineDoc], loaded.vocab.keywords))
        ) {
          if (
            stmt.t == 'create table' && stmt.name == 'machine' &&
            !has.has('machine')
          ) db.query(stmt)
        }
        for (
          let stmt of grown(
            loaded.vocab,
            stood(db, (name) => name == 'home'),
          )
        ) {
          if (
            stmt.t == 'alter table' && stmt.table == 'home' && 'add' in stmt &&
            stmt.add.name == 'machine'
          ) db.query(stmt)
        }
        // Earlier T-66421 users may already have a machine table without the
        // durable attached address. This is the only machine addition needed.
        if (!columns(db, 'machine').includes('address')) {
          db.query({
            t: 'alter table',
            table: 'machine',
            add: { name: 'address', type: 'text' },
          })
        }
        for (let stmt of indexed(loaded.vocab)) {
          if (
            stmt.on == 'machine' ||
            stmt.on == 'home' && stmt.name == 'home_machine'
          ) db.query(stmt)
        }
        expansion = expandHomes(g, db)
        second = expandHomes(g, db)
        assert(
          second.moved == 0 && second.running == 0 && second.released == 0,
          'Second expansion changed rows',
        )
      }
      if (opts.phase != 'expand' && oldColumn) {
        // A draining old worker may have created a child after expansion.
        // Once that generation is gone, attach its last homes before clearing.
        if (opts.phase == 'contract') {
          expansion = expandHomes(g, db)
          second = expandHomes(g, db)
          assert(second.moved == 0, 'Second expansion changed rows')
        }
        contracted = contractHomes(g)
        assert(contractHomes(g) == 0, 'Second contraction changed rows')
        // Clearing was a graph write, so pointers, stamps and journal agree.
        // DROP COLUMN only removes the empty physical source, not membership.
        for (
          let row of db.query({ t: 'pragma', name: 'index_list', arg: 'home' })
        ) {
          let name = String(row.name)
          let cols = db.query({ t: 'pragma', name: 'index_info', arg: name })
          if (cols.some((col) => col.name == 'worktree')) {
            assert(
              name == 'home_worktree',
              'Unaccounted index depends on legacy home.worktree: ' + name,
            )
            db.query({ t: 'drop', kind: 'index', name })
          }
        }
        db.query({ t: 'alter table', table: 'home', drop: 'worktree' })
      }
      assert(
        JSON.stringify(beforeTrees) == JSON.stringify(inventory()),
        'Existing worktree observations changed',
      )
    })
    let archetypesAfter = drift(db)
    assert(
      archetypesAfter.drifted == 0,
      'Archetype drift after migration: ' + archetypesAfter.drifted,
    )
    console.log(
      JSON.stringify({
        phase: opts.phase,
        expansion,
        contracted,
        secondExpansion: second,
        secondContraction: opts.phase == 'expand' ? undefined : 0,
        worktreesPreserved: beforeTrees.length,
        archetypes: archetypesAfter,
        workersToDrain: drain?.workers,
        legacyColumnRetained: columns(db, 'home').includes('worktree'),
      }),
    )
  } finally {
    db.close()
  }
}
if (import.meta.main) await run()
