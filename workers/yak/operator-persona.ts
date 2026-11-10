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
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link, unlink } from '@yaks/edge'
import { short } from '@yaks/id'
import type { Reads } from '@yaks/persona'
import { stringify } from '@yaks/query'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { url } from './host.ts'
import { chatPath } from './route.ts'
import { choices, type Speaking } from './speech.ts'

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
 * directory holds something else. Everything it contains is declared by code,
 * so a doc the code no longer declares leaves it.
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
  let [held, contained] = await Promise.all([
    bases(env).get([BASE, ...wanted.map((b) => b.entity.eid)]),
    meta(env).query(`.edge.from=${BASE}&.contains`),
  ])
  let kept = new Set(
    declared.map((d) => derivedEid('operator-persona|' + d.key)),
  )
  let writes = [
    ...contained
      .map((e) => String((e.edge as Comp).to))
      .filter((to) => !kept.has(to))
      .map((to) => unlink(BASE, 'contains', to)),
    ...held.some((b) => b.entity.eid == BASE && b.persona) ? [] : [{
      entity: { eid: BASE },
      persona: {},
      doc: { title: 'yaks.app Operator', body: GUIDANCE },
    }],
    ...moved(held, wanted),
  ]
  if (writes.length) await meta(env).apply(writes, KERNEL)
}

/** The Operator's settings (operator-vocab.ts `operator`), as its persona
 * holds them. */
export type Settings = {
  name?: string | null
  voice?: string | null
  voice_speed?: string | null
  voice_model?: string | null
  voice_backend?: string | null
  cache_retention?: number | null
}

/** The settings a space's directory row held, where its persona holds none
 * yet: what the store copies once (`held`). */
let copied = (space: Space): Settings =>
  Object.fromEntries(
    Object.entries({
      name: space.operator,
      voice: space.voice,
      voice_speed: space.voice_speed,
      voice_model: space.voice_model,
      voice_backend: space.voice_backend,
      cache_retention: space.cache_retention,
    }).filter(([, v]) => v != null),
  )

/** `space` as its Operator's settings say: theirs where the persona holds
 * them, a setting it does not hold being the platform's own. */
export let worn = (space: Space, own: Settings): Space => ({
  ...space,
  operator: own.name || space.operator,
  voice: own.voice ?? null,
  voice_speed: own.voice_speed ?? null,
  voice_model: own.voice_model ?? null,
  voice_backend: own.voice_backend ?? null,
  cache_retention: own.cache_retention ?? null,
})

/**
 * The Operator's settings off its persona in the store `g` reads, with
 * `space` worn in them, and the write that first copies the directory row's
 * settings onto a persona that holds none: the move of a space from before
 * its settings were its own. The copy is written only where the persona has
 * no `operator{}`, so it never overwrites what is there, and a second read
 * writes nothing.
 */
export let held = async (
  g: Reads,
  space: Space,
): Promise<{ space: Space; copy: Bundle[] }> => {
  let eid = personaFor(space.eid)
  let [row] = await g.get([eid])
  let own = row?.operator as Settings | undefined
  if (own) return { space: worn(space, own), copy: [] }
  let copy = copied(space)
  return {
    space: worn(space, copy),
    copy: [{
      entity: { eid },
      operator: copy,
      persona: { base: BASE, home: space.eid },
    }],
  }
}

/** `space` as its Operator's settings say, read off its store's persona and
 * copied there first where it held none (`held`). */
export let settled = async (
  g: Pick<Graph, 'apply'> & { storage: Reads },
  space: Space,
) => {
  let { space: now, copy } = await held(g.storage, space)
  if (copy.length) await g.apply(copy, { trusted: true })
  return now
}

/** What `space`'s Operator's settings are, after `set` is written on its
 * persona as `by` asked: the `/operator/settings` door its settings page
 * writes and a ring reads them by (build-door.ts `settingsAt`). A name set
 * here is `copy`'d to the directory before the door answers, so the page
 * that saved it reads it back at once; `operator_named` copies a name the
 * Operator sets itself. */
export let setting = async (
  g: Pick<Graph, 'apply'> & { storage: Reads },
  space: Space,
  by: string,
  set?: Settings,
  copy: (entities: Bundle[]) => Promise<unknown> = () => Promise.resolve(),
): Promise<Settings> => {
  await settled(g, space)
  if (set && Object.keys(set).length) {
    await g.apply([{
      entity: { eid: personaFor(space.eid) },
      operator: set,
      $actor: { by },
    }], { trusted: true })
  }
  let [row] = await g.storage.get([personaFor(space.eid)])
  if (set?.name) await copy(named(row))
  return (row?.operator ?? {}) as Settings
}

/** The directory's copy of the Operator's name, as persona `row` holds it:
 * what lists, letters and pages read without the store
 * (operator-vocab.ts `operator_named`). None where the row is no space's. */
export let named = (row: Bundle | undefined): Bundle[] => {
  let name = (row?.operator as Settings | undefined)?.name
  let home = (row?.persona as { home?: string } | undefined)?.home
  return name && home ? [{ entity: { eid: home }, operator: { name } }] : []
}

/** Who a space's Operator is, as its instructions say: its name, whose it
 * is, its page, whose link in a text signs the reader in
 * (operator-texts.ts `signingIn`), and where its settings are, which it
 * changes itself when asked. */
export let introduced = (space: Space, env?: Speaking) =>
  `You are ${space.operator}, the Operator of ${space.slug}, and answer to that name. You work for the owner of ${space.slug}. Don't sign your replies; a letter or a text is signed for you. Your page, where they can read your whole conversation, is ${
    url({}, chatPath(space.slug))
  }; a yaks.app link you text them signs them in when they follow it.

Your settings are yours to change when the person asks: they are operator{name, voice, voice_speed, voice_model, voice_backend} on your persona ${
    short(personaFor(space.eid))
  } in your own graph. Change one with graph_apply, self true and one bundle naming only the properties asked for, such as {"entity":{"eid":"${
    short(personaFor(space.eid))
  }"},"operator":{"voice":"<id>"}}; null puts one back to the platform's own. A name is up to 40 characters. On a call your next line is said in the voice you set, unless the call says your provider fixes it.${
    env ? `\n\nThe choices on here, by id:\n${choices(env, space)}` : ''
  }`

/**
 * The space's own persona, worn on the base: what a store whose entities `g`
 * reads still needs written to make it what `space` and its settings say.
 * Its text is the space's to write, so only its title is set.
 */
export let spaced = async (
  g: Reads,
  from: Space,
  env?: Speaking,
): Promise<Bundle[]> => {
  let eid = personaFor(from.eid)
  let { space, copy } = await held(g, from)
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
      persona: { base: BASE, home: space.eid },
    },
    { entity: { eid: space.eid }, project: {} },
    ...docs(eid, [{
      key: 'who',
      title: 'Who you are',
      body: introduced(space, env),
    }], (k) => derivedEid(`operator-persona|${k}|${space.eid}`)),
  ]
  return [
    ...copy,
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
