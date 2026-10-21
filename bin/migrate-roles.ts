// One-time (T-131376, D-131377): the role component goes.
//
//   deno run -A bin/migrate-roles.ts <config> [--apply]
//
// role{surface, scope} was the old harness's "desired fleet capacity": a
// persona hired into standing work. Each row becomes what it meant:
//
// - A persona whose role.scope is a topic is that topic's oracle: it tends the
//   topic (an edge{from, to} + tends{} link, written if missing), and its role
//   goes.
// - On any other persona, a project or a task, role is a stray stamp of the old
//   reconciler: it goes and the entity stays.
// - An entity that is nothing but a role (a doc, its role and the model it
//   asked for) is an operator record for a reconciler that no longer exists:
//   it is deleted, and what points at it goes as its references' death says.
//
// Without --apply it counts, says what each row becomes, and lists every
// reference into the rows it would delete, by the component and property
// holding it and that property's death. Writes go through the graph, signed as
// the session running it. A second run finds nothing to do.

import { compose, facet } from '@yaks/cli/host'
import type { Bundle } from '@yaks/graph'
import { link } from '@yaks/edge'
import { read } from '../packages/cli/config.ts'
import { signer } from '../packages/cli/local.ts'
import { via } from '../packages/cli/run.ts'

let [path] = Deno.args.filter((a) => !a.startsWith('--'))
if (!path) throw Error('Usage: migrate-roles.ts CONFIG [--apply]')
let apply = Deno.args.includes('--apply')

let host = await compose(read(path), ['graph'], facet, {
  process: false,
  readOnly: !apply,
})
let g = host.graph
let say = (name: string, value: unknown) =>
  console.log(JSON.stringify({ name, value }))
let q = (query: string) => Promise.resolve(g.read(query))
let count = async (query: string) =>
  Number((await g.rows(`${query} .count`))[0]?.n ?? 0)
let comp = (b: Bundle, name: string) =>
  b[name] as Record<string, unknown> | undefined
let { $actor } = await signer(host, via(), false)
if (!$actor?.via) throw Error('no session to sign as: run it from one')
say('writer', $actor)
let write = (bundles: Bundle[]) =>
  g.apply(bundles.map((b) => ({ ...b, $actor })))

let counts = async () => ({
  role: await count('.role'),
  role_persona: await count('.role .persona'),
  tends: await count('.tends'),
  persona: await count('.persona'),
  project: await count('.project'),
  task: await count('.task'),
  edge: await count('.edge'),
})

// Where a bundle holds an eid: each component.property naming it, with that
// property's death.
let holding = (b: Bundle, eid: string): string[] =>
  Object.entries(b).flatMap(([name, value]) =>
    name == 'entity' || name.startsWith('$') || !value ||
      typeof value != 'object'
      ? []
      : Object.entries(value as Record<string, unknown>)
        .filter(([, v]) =>
          v == eid || (Array.isArray(v) && v.includes(eid)) ||
          (typeof v == 'string' && v.includes(eid))
        )
        .map(([prop]) =>
          `${name}.${prop}:${host.vocab.prop(name, prop)?.death ?? 'none'}`
        )
  )

try {
  say('before', await counts())
  let topics = new Set((await q('.topic')).map((b) => b.entity.eid))
  let rows = await q('.role *')
  let kept = rows.filter((b) => b.persona || b.project || b.task)
  let doomed = rows.filter((b) => !kept.includes(b))

  for (let b of kept) {
    let eid = b.entity.eid
    let scope = String(comp(b, 'role')?.scope ?? '')
    let tends = !!b.persona && topics.has(scope)
    say('strip', {
      eid,
      title: comp(b, 'doc')?.title,
      role: comp(b, 'role'),
      ...tends ? { tends: scope } : {},
    })
    if (apply) {
      await write([
        ...tends ? [{ ...link(eid, 'tends', scope), tends: {} }] : [],
        { entity: { eid }, role: null },
      ])
    }
  }

  let tally: Record<string, string[]> = {}
  for (let b of doomed) {
    let eid = b.entity.eid
    let refs = await q(`.refs=${eid} *`)
    for (let r of refs) {
      for (let at of holding(r, eid)) (tally[at] ??= []).push(r.entity.eid)
    }
    say('delete', {
      eid,
      title: comp(b, 'doc')?.title,
      components: Object.keys(b).filter((k) => k != 'entity' && k[0] != '$'),
      references: refs.length,
    })
  }
  say(
    'references into deleted rows',
    Object.fromEntries(
      Object.entries(tally).map((
        [at, eids],
      ) => [at, { n: eids.length, some: eids.slice(0, 3) }]),
    ),
  )
  if (apply && doomed.length) {
    await write(doomed.map((b) => ({
      entity: { eid: b.entity.eid },
      $delete: true as const,
    })))
  }
  say('after', await counts())
} finally {
  await host.close()
}
