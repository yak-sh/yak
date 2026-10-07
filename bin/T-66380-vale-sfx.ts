// Plan and rehearse the Vale sound cleanup from read-only exports. This script
// never opens the live store, starts effects, or invokes a generation tool.
import { type Bundle, type Comp, graph, token } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { derived } from '@yaks/builders/vocab'
import { opening } from '../packages/builders/effects.ts'
import { plugins } from '../packages/builders/graph.ts'
import { keys } from '@yaks/key'
import { sessionDerived } from '@yaks/session/status'
import { appVocab } from '../workers/yak/vocab.ts'

let [directory, destination, mode = 'proof'] = Deno.args
if (!destination || directory == destination) {
  throw new Error('exports and output directories must be distinct')
}
if (!directory) {
  throw new Error(
    'usage: T-66380-vale-sfx.ts exports-directory destination [proof|plan]',
  )
}
let manifest = JSON.parse(
  await Deno.readTextFile(new URL('../apps/vale/vocab.json', import.meta.url)),
)
let vocab = appVocab(manifest)
let rows = new Map<string, Bundle>()
for await (let file of Deno.readDir(directory)) {
  if (
    ![
      'sfx',
      'builder',
      'builder_dep',
      'build',
      'built',
      'call',
      'session',
      'entry',
      'artifact',
      'key',
      'edge',
      'output',
      'result',
      'spawned',
      'sounds',
      'song',
      'theme_design',
      'beast_design',
      'tool',
      'rows',
    ].some((name) => file.name == `${name}.json`)
  ) continue
  let value = JSON.parse(await Deno.readTextFile(`${directory}/${file.name}`))
  if (!Array.isArray(value)) continue
  for (let row of value) {
    if (!row?.entity?.eid || row.entity.eid.startsWith('$')) continue
    let { kind: _kind, $actor: _actor, ...bundle } = row
    let before = rows.get(bundle.entity.eid)
    rows.set(bundle.entity.eid, { ...before, ...bundle })
  }
}
let component = (row: Bundle, name: string): Comp => (row[name] ?? {}) as Comp
let all = [...rows.values()]
let plan = (all: Bundle[]) => {
  let rows = new Map(all.map((row) => [row.entity.eid, row]))
  let groups = new Map<string, Bundle[]>()
  for (let row of all.filter((r) => r.sfx)) {
    let name = String(component(row, 'sfx').name)
    groups.set(name, [...groups.get(name) ?? [], row])
  }
  let removed = new Set<string>()
  let keep = new Set<string>()
  let guards: Bundle[] = []
  let reasons = new Map<string, string>()
  let remove = (row: Bundle, why: string) => {
    let eid = row.entity.eid
    if (keep.has(eid)) throw new Error(`refusing to remove kept sound ${eid}`)
    if (removed.has(eid)) return false
    removed.add(eid)
    reasons.set(eid, why)
    return true
  }
  let guard = (row: Bundle, paths: string[]) => {
    let was: Record<string, Record<string, string | null>> = {}
    for (let path of paths) {
      let [name, prop] = path.split('.')
      ;(was[name] ??= {})[prop] = token(component(row, name)[prop])
    }
    return { entity: { eid: row.entity.eid }, $was: was } as Bundle
  }
  let decisions: unknown[] = []
  for (let [name, copies] of groups) {
    if (copies.length == 1) continue
    let parsed = /^creature-(.+)-(cry|step)$/.exec(name)
    if (!parsed) throw new Error(`ambiguous duplicate sound name ${name}`)
    let [, source, slot] = parsed
    let builds = all.filter((r) =>
      r.build && component(r, 'build').for == source &&
      component(r, 'build').variant == 'main'
    )
    let kinds = all.filter((r) =>
      r.beast_design && r.chosen && r.built && builds.some((b) =>
        b.entity.eid == component(r, 'built').build
      ) && component(r, 'built').slot == 'kind'
    )
    let refs = new Set(
      kinds.map((r) => component(r, 'sounds')[slot]).filter(Boolean),
    )
    if (kinds.length != 1 || refs.size != 1) {
      throw new Error(
        `ambiguous creature sounds for ${name}: ${JSON.stringify([...refs])}`,
      )
    }
    let selected = String([...refs][0])
    if (!copies.some((r) => r.entity.eid == selected)) {
      throw new Error(`creature sound does not belong to ${name}`)
    }
    keep.add(selected)
    guards.push(guard(kinds[0], [
      `sounds.${slot}`,
      'built.build',
      'built.call',
      'chosen.at',
    ]))
    let main = rows.get(String(component(kinds[0], 'built').build))!
    guards.push(guard(main, [
      'build.call',
      'build.stale',
      'build.builder',
      'build.for',
      'build.variant',
    ]))
    for (let copy of copies) {
      if (copy.entity.eid != selected) remove(copy, `duplicate of ${selected}`)
    }
    decisions.push({
      name,
      source,
      kind: kinds[0].entity.eid,
      keep: selected,
      remove: copies.filter((r) => r.entity.eid != selected).map((r) =>
        r.entity.eid
      ),
    })
  }
  // These are ownership links in the generation pipeline. Creature builds and
  // their shared model sessions are parents, and are deliberately retained.
  let owns = [
    ['build', 'for'],
    ['built', 'build'],
    ['call', 'source'],
    ['session', 'source'],
    ['entry', 'session'],
    ['result', 'call'],
    ['output', 'source'],
    ['key', 'of'],
    ['edge', 'from'],
    ['edge', 'to'],
  ]
  let sweep = () => {
    let changed = false
    for (let row of all) {
      if (removed.has(row.entity.eid)) continue
      let link = owns.find(([name, prop]) =>
        removed.has(String(component(row, name)[prop] ?? ''))
      )
      if (link) changed = remove(row, `${link[0]}.${link[1]}`) || changed
    }
    return changed
  }
  while (sweep()) { /* closure */ }
  let artifactRefs = (row: Bundle): string[] => {
    let found: string[] = []
    for (let name of ['built', 'attachment']) {
      let id = component(row, name).artifact
      if (typeof id == 'string') found.push(id)
    }
    return found
  }
  let candidates = new Set(
    all.filter((r) => removed.has(r.entity.eid)).flatMap(artifactRefs),
  )
  for (let id of candidates) {
    let row = rows.get(id)
    if (!row?.artifact) throw new Error(`missing artifact ${id} from snapshot`)
    let shared = all.some((r) =>
      !removed.has(r.entity.eid) && artifactRefs(r).includes(id)
    )
    if (!shared) remove(row, 'unshared generated recording')
  }
  while (sweep()) { /* artifact keys and edges */ }
  let deletes = all.filter((r) => removed.has(r.entity.eid)).map((row) => ({
    ...guard(
      row,
      Object.entries(row).flatMap(([name, value]) =>
        name == 'entity' || name.startsWith('$') || !value
          ? []
          : Object.keys(value as Comp).filter((p) =>
            !vocab.prop(name, p)?.computed
          ).map((p) => `${name}.${p}`)
      ),
    ),
    $delete: true,
  }))
  let patches = [...guards, ...deletes]
  return { groups, removed, keep, deletes, patches, decisions }
}
let { groups, removed, keep, deletes, patches, decisions } = plan(all)
await Deno.mkdir(destination, { recursive: true })
await Deno.writeTextFile(
  `${destination}/cleanup.json`,
  JSON.stringify(patches, null, 2),
)
await Deno.writeTextFile(
  `${destination}/decisions.json`,
  JSON.stringify(decisions, null, 2),
)
await Deno.writeTextFile(
  `${destination}/removed.json`,
  JSON.stringify(all.filter((r) => removed.has(r.entity.eid)), null, 2),
)
let counts = (values: Bundle[]) =>
  Object.fromEntries(
    [
      'sfx',
      'build',
      'built',
      'call',
      'session',
      'entry',
      'artifact',
      'key',
      'edge',
      'result',
      'output',
      'sounds',
    ].map((name) => [name, values.filter((r) => r[name]).length]),
  )
if (mode == 'plan') {
  console.log(
    JSON.stringify(
      { before: counts(all), deletes: deletes.length, decisions },
      null,
      2,
    ),
  )
  Deno.exit()
}
let driver = open(':memory:')
let db = storage(driver, vocab, {
  derived: { ...derived(vocab), ...sessionDerived(vocab) },
})
db.install()
await db.tx((tx) => tx.patch(all))
let g = graph({ storage: db, vocab, plugins: [...plugins(), keys(vocab)] })
let rehearsal = async () => {
  let report: unknown[] = []
  for (let builder of (await g.read('.builder *'))) {
    let written: Bundle[] = []
    await opening({ vocab })(
      { kind: 'started', name: 'builder', entity: builder.entity },
      g.outside,
      async (patches) => {
        if (
          patches.some((r) => r.call)
        ) {
          throw new Error(
            `${builder.entity.eid}: automatic opening scheduled a call`,
          )
        }
        let applied = await g.apply(patches, { trusted: true, check: true })
        if (applied.some((r) => r.call)) {
          throw new Error('immediate opening reconciliation generated a call')
        }
        written.push(...applied)
        return applied
      },
    )
    report.push({
      builder: builder.entity.eid,
      staged: !!builder.staged,
      checkedWrites: written.length,
      calls: 0,
    })
  }
  return report
}
let beforeReconcile = await rehearsal()
let before = await g.read('*')
let protectedRows = await g.get([...keep])
let recording = (values: Bundle[]) =>
  values.filter((row) => {
    let build = rows.get(String(component(row, 'built').build))
    return row.built && build?.build &&
      keep.has(String(component(build, 'build').for))
  }).map((row) => ({
    eid: row.entity.eid,
    call: component(row, 'built').call,
    artifact: component(row, 'built').artifact,
    chosen: row.chosen,
  }))
let preservedRecordings = JSON.stringify(recording(before))
let wrote = await g.apply(patches, { trusted: true })
let after = await g.read('*')
if (wrote.some((r) => r.call && !removed.has(r.entity.eid))) {
  throw new Error('cleanup generated a call')
}
if (JSON.stringify(await g.get([...keep])) != JSON.stringify(protectedRows)) {
  throw new Error('kept sound changed')
}
if (JSON.stringify(recording(after)) != preservedRecordings) {
  throw new Error('kept recording or its choice changed')
}
if (after.filter((r) => r.sfx).length != groups.size) {
  throw new Error('sound count does not equal unique names')
}
let afterGroups = new Set(
  after.filter((r) => r.sfx).map((r) => String(component(r, 'sfx').name)),
)
if (afterGroups.size != groups.size) throw new Error('a sound name was lost')
for (let row of after) {
  for (
    let name of [
      'sounds',
      'built',
      'build',
      'call',
      'session',
      'entry',
      'key',
      'edge',
      'result',
      'output',
      'attachment',
    ]
  ) {
    for (let [prop, value] of Object.entries(component(row, name))) {
      if (vocab.prop(name, prop)?.ref && removed.has(String(value))) {
        throw new Error(
          `surviving ${row.entity.eid} ${name}.${prop} references removed ${value}`,
        )
      }
    }
  }
}
let again = plan(after)
if (again.deletes.length || again.decisions.length) {
  throw new Error('second cleanup plan is not empty')
}
await Deno.mkdir(`${destination}/after`, { recursive: true })
await Deno.writeTextFile(
  `${destination}/after/rows.json`,
  JSON.stringify(after),
)
let reconcileReports = await rehearsal()
let report = {
  before: counts(before),
  after: counts(after),
  explicitDeletes: deletes.length,
  appliedEntities: wrote.length,
  secondPlannedDeletes: again.deletes.length,
  beforeReconciliation: beforeReconcile,
  reconciliation: reconcileReports,
  callsGenerated: 0,
}
await Deno.writeTextFile(
  `${destination}/proof.json`,
  JSON.stringify(report, null, 2),
)
console.log(JSON.stringify(report, null, 2))
driver.close()
