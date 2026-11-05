// Who an Operator is and how it works, as personas in the graph (D-137704,
// "Layers"), worn through @yaks/persona like any agent's in the fleet.
//
// Two layers. The base is the yaks.app Operator persona, one for the whole
// platform, kept in the directory. Its own text is the general guidance, a doc
// a person edits: the code writes it once, when it is not there, and never
// again. What it contains is what the Operator knows because of code (what
// yaks.app is, how its conversation and forks work), each doc declared beside
// the code it describes and rewritten here when that code's text moves. On it
// is worn each space's own persona, kept in that space's Operator store: whose
// it is and what it is called, and whatever the space adds to its text.
//
// An edge stays within one store, so the space's persona names the base by
// its eid (`persona.base`) and the runner reads it from the directory at each
// ask (@yaks/harness `wear`): a change to the base reaches every Operator on
// its next turn, with nothing copied into the spaces.
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import type { Reads } from '@yaks/persona'
import { stringify } from '@yaks/query'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'

/** The persona every Operator is worn on, kept in the directory. */
export let BASE = derivedEid('operator-persona|base')

/** The Operator is a persona; the space it works for is a topic. Their
 * contains edges serve different purposes. */
export let personaFor = (space: Eid) =>
  derivedEid('operator-persona|space|' + space)

/** A doc the code declares: what the Operator knows because of that code. */
export type Declared = { key: string; title: string; body: string }

// The base's own text, written only where there is none: a person edits it
// from then on.
let GUIDANCE =
  "Read the app's schema and rows before changing data. Ask when required details are missing; never invent meeting dates, times or legal text. A request may be an idea or a design prepared by another agent."

/** The directory, read as a persona's bases are (@yaks/persona `wear`). */
export let bases = (env: Pick<Env, 'STORE' | 'META' | 'CLOCK'>): Reads => ({
  read: (q) => meta(env).query(stringify(q as Parameters<typeof stringify>[0])),
  get: (eids) =>
    eids.length
      ? meta(env).query(`.entity.eid=${eids.join(',')}`)
      : Promise.resolve([]),
})

// The bundles of `wanted` that say something `held` does not: a component
// missing, or a property with another value.
export let moved = (held: Bundle[], wanted: Bundle[]): Bundle[] => {
  let by = new Map(held.map((b) => [b.entity.eid, b]))
  return wanted.filter((w) => {
    let was = by.get(w.entity.eid)
    return Object.entries(w).some(([name, comp]) =>
      name != 'entity' && (!was?.[name] ||
        Object.entries(comp as Comp).some(([p, v]) =>
          JSON.stringify((was[name] as Comp)[p]) != JSON.stringify(v)
        ))
    )
  })
}

let docs = (from: Eid, declared: Declared[], key: (k: string) => Eid) =>
  declared.flatMap((d, i) => [
    { entity: { eid: key(d.key) }, doc: { title: d.title, body: d.body } },
    link(from, 'contains', key(d.key), i + 1),
  ])

/**
 * Keep the base as the code declares it: the persona, with its guidance where
 * it has none, and each declared doc it contains, written only where the
 * directory holds something else.
 */
export let declare = async (
  env: Pick<Env, 'STORE' | 'META' | 'CLOCK'>,
  declared: Declared[],
) => {
  let wanted = docs(
    BASE,
    declared,
    (k) => derivedEid('operator-persona|' + k),
  )
  let held = await bases(env).get([BASE, ...wanted.map((b) => b.entity.eid)])
  let writes = [
    ...held.some((b) => b.entity.eid == BASE) ? [] : [{
      entity: { eid: BASE },
      persona: {},
      doc: { title: 'yaks.app Operator', body: GUIDANCE },
    }],
    ...moved(held, wanted),
  ]
  if (writes.length) await meta(env).apply(writes, KERNEL)
}

/** Who a space's Operator is, as its instructions say: its name and whose it
 * is. */
export let introduced = (space: Space) =>
  `You are ${space.operator}, the Operator of ${space.slug}, and answer to that name. You work for the owner of ${space.slug}. Don't sign your replies; a letter or a text is signed for you.`

/**
 * The space's own persona, worn on the base: what a store whose entities `g`
 * reads still needs written to make it what `space` says. Its text is the
 * space's to write, so only its title is set.
 */
export let spaced = async (g: Reads, space: Space): Promise<Bundle[]> => {
  let eid = personaFor(space.eid)
  let [old] = await g.get([space.eid])
  let moving = !!old?.persona
  // Earlier Operators wore the space itself as their persona. Move that
  // persona's editable text and holdings together, with its sessions, before
  // discovery gives the space any topic holdings. Repeating this moves none.
  let links = moving ? await g.read(`.contains .edge.from=${space.eid}`) : []
  let sessions = moving ? await g.read(`.session.persona=${space.eid}`) : []
  let wanted = [
    {
      entity: { eid },
      doc: {
        ...moving ? old.doc as Comp : {},
        title: `${space.operator}, the Operator of ${space.slug}`,
      },
      persona: { base: BASE },
    },
    { entity: { eid: space.eid }, project: {} },
    ...docs(eid, [{
      key: 'who',
      title: 'Who you are',
      body: introduced(space),
    }], (k) => derivedEid(`operator-persona|${k}|${space.eid}`)),
  ]
  return [
    ...moving
      ? [
        {
          entity: { eid: space.eid },
          persona: null,
          doc: { title: space.title, body: null },
        },
        ...links.flatMap((b) => [
          link(
            eid,
            'contains',
            String((b.edge as Comp).to),
            Number((b.edge as Comp).ord ?? 0),
          ),
          { entity: b.entity, $delete: true },
        ]),
        ...sessions.map((b) => ({
          entity: b.entity,
          session: { persona: eid },
        })),
      ]
      : [],
    ...moved(await g.get(wanted.map((b) => b.entity.eid)), wanted),
  ]
}
