// Owner-invoked no-call conversion, using vocabulary facets and graph writes.
// Explicit db path; no host, effects, tools or provider factories are started.
import { words } from '@yaks/cli/host'
import { read } from '../packages/cli/config.ts'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { archetypes } from '@yaks/archetype'
import { journal, log } from '@yaks/journal'
import { keys } from '@yaks/key'
import { storage } from '@yaks/sqlite'
import { tally } from '@yaks/sql'
import { open } from '@yaks/sqlite/db'
import { frozenMove, takeMove } from '../packages/builders/takes.ts'

let path = Deno.args[0]
if (!path || Deno.args.length != 1) {
  throw Error('explicit database path required')
}
await Deno.stat(path)
let config = { ...read('/home/yaks/.yak/yak.json'), db: path }
let loaded = await words(config)
let sql = open(path)
try {
  let db = storage(sql, loaded.vocab, {
    derived: loaded.derived,
    backed: loaded.backed,
    schemaReady: () => true,
    number: config.numbers,
  })
  let actor = {
    by: 'b4337949-3029-4f3f-9e32-21c2e328f4ad',
    via: 'b4337949-3029-4f3f-9e32-21c2e328f4ad',
  }
  let g = graph({
    storage: db,
    vocab: loaded.vocab,
    actor,
    plugins: [
      archetypes(),
      keys(loaded.vocab),
      journal(log({ rows: (s) => sql.query(s), derived: loaded.derived })),
    ],
  })
  let counts = () =>
    Object.fromEntries(
      [
        'entity',
        'tombstone',
        'build',
        'built',
        'call',
        'session',
        'artifact',
        'key',
        'chosen',
      ].map((name) => [name, tally(sql, name)]),
    )
  let before = counts()
  let outputs = await g.read('.built&*')
  let builds = await g.read('.build&*')
  let locators = await g.read('.output_of&*')
  let callIds = [
    ...new Set([
      ...outputs.map((r) => (r.built as Comp).call),
      ...builds.map((r) => (r.build as Comp).call),
    ].filter((v): v is string => typeof v == 'string')),
  ]
  let calls: Bundle[] = []
  for (let i = 0; i < callIds.length; i += 50) {
    calls.push(...await g.get(callIds.slice(i, i + 50)))
  }
  let frozen = builds.flatMap((row) =>
    frozenMove(row, calls.find((c) => c.entity.eid == (row.build as Comp).call))
  )
  let apply = async (patch: Bundle[]) => {
    if (patch.some((r) => r.$delete)) {
      throw Error('conversion tried to delete an entity')
    }
    for (let i = 0; i < patch.length; i += 50) {
      await g.apply(patch.slice(i, i + 50), { trusted: true })
    }
  }
  let evidence = [...builds, ...outputs, ...locators, ...calls]
  let planned = outputs.map((row) => takeMove(row, evidence))
  await apply(frozen)
  let converted = 0, patches = 0
  // Each take's whole patch commits together (locator retirement and new key).
  for (let patch of planned) {
    if (patch.length) {
      if (patch.some((r) => r.$delete)) {
        throw Error('conversion tried to delete an entity')
      }
      await g.apply(patch, { trusted: true })
      converted++
      patches += patch.length
    }
  }
  let after = counts()
  let now = await g.read('.built&*')
  let kept = (row: Bundle) => {
    let { inputs: _inputs, current: _current, ...built } = row.built as Comp
    let { updated: _updated, chosen: _chosen, $actor: _actor, ...rest } = row
    return { ...rest, built }
  }
  let old = new Map(outputs.map((r) => [r.entity.eid, JSON.stringify(kept(r))]))
  if (
    now.length != outputs.length ||
    now.some((r) => old.get(r.entity.eid) != JSON.stringify(kept(r)))
  ) throw Error('output content or ids changed')
  for (
    let name of ['tombstone', 'build', 'built', 'call', 'session', 'artifact']
  ) {
    if (before[name] != after[name]) throw Error(`count changed: ${name}`)
  }
  let finalEvidence = [
    ...await g.read('.build&*'),
    ...now,
    ...await g.read('.output_of&*'),
    ...calls,
  ]
  let second = now.flatMap((r) => takeMove(r, finalEvidence)).length
  let secondBuilds = finalEvidence.filter((r) =>
    r.build
  ).flatMap((r) =>
    frozenMove(r, calls.find((c) => c.entity.eid == (r.build as Comp).call))
  ).length
  if (second || secondBuilds) {
    throw Error(`second run not empty: ${second}, ${secondBuilds}`)
  }
  console.log(
    JSON.stringify({
      before,
      after,
      frozenBuilds: frozen.length,
      converted,
      patches,
      second,
      secondBuilds,
      contentPreserved: true,
      generationCalls: 0,
    }),
  )
} finally {
  sql.close()
}
