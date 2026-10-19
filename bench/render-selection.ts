// Offline selection replay using the browse registry's literal registrations.
// Spreads and rendering bodies are excluded: this measures selection alone,
// not paint or a captured request mix. Pass an old mod.ts as the first arg
// (with its relative imports resolved) to compare in a fresh process:
// deno run --cached-only --allow-read bench/render-selection.ts [module-url]
import { and, parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab/runtime'
import type { Bundle, Registration } from '@yaks/render'

let api: typeof import('@yaks/render') = await import(
  Deno.args[0] ?? new URL('../packages/render/mod.ts', import.meta.url).href
)
let source = await Deno.readTextFile(
  new URL('../packages/browse/components/Entity.tsx', import.meta.url),
)
let curated = source.split('define([')[1].split('// The context-menu')[0]
let pattern =
  /view:\s*'([^']+)',\s*match:\s*(true|and\(\)|(?:and\()?parse\('([^']*)'\)\)?)/g
let entries = [...curated.matchAll(pattern)]
let rows: Registration[] = entries.map((m) => ({
  view: m[1],
  match: m[2] == 'true' ? true : m[2] == 'and()' ? and() : parse(m[3]),
}))
let tabs = [...curated.split('], [')[1].matchAll(/'([^']+)'/g)]
  .map((m) => m[1])
let names = [
  ...new Set(
    entries.flatMap((m) =>
      [...(m[3] ?? '').matchAll(/(?:^|[ (])\.([a-z_]+)/g)].map((m) => m[1])
    ),
  ),
]
let vocab = loadVocab([{
  $defs: {
    ...Object.fromEntries(names.map((name) => [name, { component: true }])),
    doc: { component: true, properties: { title: { type: 'string' } } },
  },
}])
let bundles: Bundle[] = [
  { entity: { eid: 'task' }, doc: { title: 'Task' }, task: {} },
  { entity: { eid: 'project' }, doc: { title: 'Project' }, project: {} },
  { entity: { eid: 'board' }, doc: { title: 'Board' }, board: {} },
  { entity: { eid: 'session' }, doc: { title: 'Session' }, session: {} },
  { entity: { eid: 'entry' }, entry: {}, content: {}, result: {} },
  { entity: { eid: 'empty' } },
]
let asks = [
  'List.Tile',
  'Board.List.Tile',
  'Inline',
  'Card.Title',
  'Title',
  'Meta',
  'Full',
  'Summary',
  'Dependency',
  'Missing.View',
  undefined,
]
let tables = new Map(bundles.map((b) => [
  b.entity.eid,
  Object.keys(b).filter((key) => key != 'entity'),
]))
bundles = bundles.map((b) => ({
  ...b,
  entity: { ...b.entity, archetype: b.entity.eid },
}))
let options = {
  views: tabs,
  archetypes: (id: string) => tables.get(id),
}
let reg = api.define(rows, options)
let chosen = (r: Registration | undefined) => r ? rows.indexOf(r) : -1
let answers = bundles.map((b) => ({
  picks: asks.map((view) => chosen(api.resolve(reg, b, view, vocab))),
  tabs: api.applicable(reg, b, vocab),
}))
let checksum = 0
let named = () => {
  for (let b of bundles) {
    for (let view of asks.slice(0, -1)) {
      checksum += api.resolve(reg, b, view, vocab) ? 1 : 0
    }
  }
}
let unnamed = () => {
  for (let b of bundles) {
    checksum += api.resolve(reg, b, undefined, vocab) ? 1 : 0
  }
}
let eligible = () => {
  for (let b of bundles) checksum += api.applicable(reg, b, vocab).length
}
let cold = () => {
  let fresh = api.define(rows, options)
  checksum += api.resolve(fresh, bundles[0], 'Board.List.Tile', vocab) ? 1 : 0
}
let measure = (run: () => void, count: number) => {
  let start = performance.now()
  for (let i = 0; i < count; i++) run()
  return performance.now() - start
}
for (let run of [named, unnamed, eligible, cold]) measure(run, 500)
let cases: [string, () => void, number][] = [
  ['named', named, 2000],
  ['unnamed', unnamed, 2000],
  ['applicable', eligible, 2000],
  ['cold', cold, 2000],
]
let times = Object.fromEntries(cases.map(([name, run, count]) => [
  name,
  Array.from({ length: 7 }, () => measure(run, count)),
]))
console.log(JSON.stringify({
  runtime: Deno.version,
  rounds: 7,
  iterations: 2000,
  archetypes: true,
  rows: rows.length,
  views: new Set(rows.map((r) => r.view)).size,
  bundles: bundles.length,
  asks,
  answers,
  times,
  checksum,
}))
