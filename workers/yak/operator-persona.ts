// Who an Operator is and how it works, as personas in the graph (D-137704,
// "Layers"), worn through @yaks/persona like any agent's in the fleet.
//
// Two layers. The base is the yaks.app Operator persona, one for the whole
// platform, kept in the directory. It is data: the files under
// plugins/yaks.app/persona/, its own text and each doc it contains (what
// yaks.app is, how its conversation and forks work), which `based` keeps in
// the directory as they say it (@yaks/persona `shipped` and `kept`). On it is
// worn each space's own persona, kept in that space's Operator store: whose it
// is and what it is called, and whatever the space adds to its text.
//
// An edge stays within one store, so the space's persona names the base by
// its eid (`persona.base`) and the runner reads it from the directory at each
// ask (@yaks/harness `wear`): a change to the base reaches every Operator on
// its next turn, with nothing copied into the spaces.
import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  unheld,
} from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import { short } from '@yaks/id'
import { kept, type Reads, shipped } from '@yaks/persona'
import { stringify } from '@yaks/query'
import { fill } from '@yaks/yaml'
import { PERSONA } from './content.ts'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { FREE, LETTERS, PRICE } from './meter.ts'
import { KERNEL, meta } from './meta.ts'
import { url } from '@yaks/platform/host'
import { chatPath } from '@yaks/platform/routes'
import { choices, type Speaking } from './speech.ts'
import { speechFrom } from '@yaks/speech'

/** The persona every Operator is worn on, kept in the directory: the file
 * plugins/yaks.app/persona/base.md, as each doc's eid is its file's name. */
export let BASE = derivedEid('operator-persona|base')

/** The Operator is a persona; the space it works for is a topic. Their
 * contains edges serve different purposes. */
export let personaFor = (space: Eid) =>
  derivedEid('operator-persona|space|' + space)

/** The directory, read as a persona's bases are (@yaks/persona `wear`). */
export let bases = (env: Pick<Env, 'STORE' | 'META' | 'CLOCK'>): Reads => ({
  read: (q) => meta(env).query(stringify(q as Parameters<typeof stringify>[0])),
  get: (eids) =>
    eids.length
      ? meta(env).query(`.entity.eid=${eids.join(',')}`)
      : Promise.resolve([]),
})

// What the base's files leave to the platform to say: what a free space
// holds, and what Plus costs and adds (meter.ts), which starting.md tells
// someone signing up.
let slots = () => ({
  free_apps: String(FREE.apps),
  free_emails: String(LETTERS.free),
  plus_price: String(PRICE.plus),
  plus_emails: LETTERS.plus.toLocaleString('en-US'),
})

/** Keep the base in the directory as plugins/yaks.app/persona says it,
 * writing only what the directory holds otherwise. */
export let based = async (env: Pick<Env, 'STORE' | 'META' | 'CLOCK'>) => {
  let said = slots()
  let rows = shipped(
    Object.fromEntries(
      Object.entries(PERSONA).map(([name, text]) => [name, fill(text, said)]),
    ),
    (name) => derivedEid('operator-persona|' + name),
  )
  let writes = await kept(bases(env), rows)
  if (writes.length) await meta(env).apply(writes, KERNEL)
}

// Each doc of `said`, contained by persona `from` in its order.
let docs = (
  from: Eid,
  said: { key: string; title: string; body: string }[],
  key: (k: string) => Eid,
) =>
  said.flatMap((d, i) => [
    { entity: { eid: key(d.key) }, doc: { title: d.title, body: d.body } },
    link(from, 'contains', key(d.key), i + 1),
  ])

/** The Operator's settings, as its page and its door speak them. Its persona
 * keeps them as its own words: the name is its `doc{title}`, the voice its
 * @yaks/speech `speech{voice, pace, model, backend}`, and the cache its
 * @yaks/model `cache{retention}`; none, the platform's own. */
export type Settings = {
  name?: string | null
  voice?: string | null
  voice_speed?: string | null
  voice_model?: string | null
  voice_backend?: string | null
  cache_retention?: number | null
}

/** The settings persona `row` holds, its speech worn on its base's
 * (`base`). */
let settingsOf = (row: Bundle | undefined, base?: Bundle): Settings => {
  let said = speechFrom(row, base)
  return {
    name: ((row?.doc as Comp | undefined)?.title as string) ?? null,
    voice: said.voice ?? null,
    voice_speed: said.pace ?? null,
    voice_model: said.model ?? null,
    voice_backend: said.backend ?? null,
    cache_retention: ((row?.cache as Comp | undefined)?.retention as number) ??
      null,
  }
}

// What `set` writes on persona `eid`: only the settings it names, null
// putting one back to its base's or the platform's. A name is never null.
let stored = (eid: Eid, set: Settings): Bundle => {
  let speech = Object.fromEntries(
    ([
      ['voice', 'voice'],
      ['pace', 'voice_speed'],
      ['model', 'voice_model'],
      ['backend', 'voice_backend'],
    ] as const).filter(([, k]) => k in set).map(([p, k]) => [p, set[k]]),
  )
  return {
    entity: { eid },
    ...set.name ? { doc: { title: set.name } } : {},
    ...Object.keys(speech).length ? { speech } : {},
    ...'cache_retention' in set
      ? { cache: { retention: set.cache_retention ?? null } }
      : {},
  }
}

// The settings that held none: a property the old `operator{}` (or the
// directory row) does not hold is left out, so moving it writes no null.
let present = (o: Settings): Settings =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

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
 * `space` worn in them, and the write that moves a persona from before they
 * were its own words, the one shape after it:
 *
 * - one holding the retired `operator{}` (T-151515) has it moved onto its
 *   title, `speech{}` and `cache{}`, and `operator{}` taken off;
 * - one without a home (from before T-151515), or none at all, is given the
 *   directory row's name and the settings the row held then.
 *
 * A persona with a home and no `operator{}` has moved, and a second read
 * writes nothing.
 */
export let held = async (
  g: Reads,
  space: Space,
): Promise<{ space: Space; copy: Bundle[] }> => {
  let eid = personaFor(space.eid)
  let [row] = await g.get([eid])
  let home = (row?.persona as { home?: string } | undefined)?.home
  if (home && !row.operator) {
    return { space: worn(space, settingsOf(row)), copy: [] }
  }
  let was = present(
    (row?.operator as Settings | undefined) ?? {
      voice: space.voice,
      voice_speed: space.voice_speed,
      voice_model: space.voice_model,
      voice_backend: space.voice_backend,
      cache_retention: space.cache_retention,
    },
  )
  let moved = stored(eid, { ...was, name: was.name || space.operator })
  let copy = {
    ...moved,
    ...row?.operator ? { operator: null } : {},
    persona: { base: BASE, home: space.eid },
  }
  return { space: worn(space, settingsOf(moved)), copy: [copy] }
}

/** `space` as its Operator's settings say, read off its store's persona and
 * moved there first where it was not (`held`). */
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
  let eid = personaFor(space.eid)
  if (set && Object.keys(set).length) {
    await g.apply([{ ...stored(eid, set), $actor: { by } }], {
      trusted: true,
    })
  }
  let [row] = await g.storage.get([eid])
  if (set?.name) await copy(named(row))
  return settingsOf(row)
}

/** The directory's copy of the Operator's name, as persona `row` holds it:
 * what lists, letters and pages read without the store
 * (@yaks/platform's `operator{name}`). None where the row is no space's. */
export let named = (row: Bundle | undefined): Bundle[] => {
  let name = (row?.doc as Comp | undefined)?.title as string | undefined
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

Your settings are yours to change when the person asks, on your persona ${
    short(personaFor(space.eid))
  } in your own graph: your name is its doc{title}, and how you speak on a call its speech{voice, pace, model, backend}. Change one with graph_apply, self true and one bundle naming only the properties asked for, such as {"entity":{"eid":"${
    short(personaFor(space.eid))
  }"},"speech":{"voice":"<id>"}} or {"entity":{"eid":"${
    short(personaFor(space.eid))
  }"},"doc":{"title":"<name>"}}; null puts a speech property back to the platform's own. A name is up to 40 characters. On a call your next line is said in the voice you set, unless the call says your provider fixes it.${
    env ? `\n\nThe choices on here, by id:\n${choices(env, space)}` : ''
  }`

/**
 * The space's own persona, worn on the base: what a store whose entities `g`
 * reads still needs written to make it what `space` and its settings say.
 * Its text is the space's to write, and its title the Operator's name.
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
      ...moving ? { doc: { ...old.doc as Comp, title: space.operator } } : {},
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
    ...unheld(await g.get(wanted.map((b) => b.entity.eid)), wanted),
  ]
}
