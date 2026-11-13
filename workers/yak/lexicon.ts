// Which app stores a search could find anything in, known without waking them
// (T-133890). The connector's `search` used to ask every store in reach, twice
// (the hits, then their bundles), and waited on the slowest: 85 hops and about
// 800 ms for an account with forty apps, most of whose stores held nothing
// the words could match.
//
// Each app store keeps its lexicon (@yaks/fts lexicon.ts) in one object, the
// `Lexicon`: the first letters of every word its indexes hold. A search asks
// that object which stores in reach could match, and asks only those.
//
// - A store's whole lexicon is read off its indexed text by its alarm, once
//   for the fields it indexes (`put`). Until then the store is asked, as
//   before.
// - Every write after that adds the words it brought (`grow`). A grow that
//   arrives before the whole read is kept and joined to it, so a write racing
//   the read loses nothing.
// - An entry is only ever added to: a deleted row leaves its words behind,
//   which costs a store asked for nothing, never a hit lost.
// - An entry is good for the searchable fields it was read under. A search
//   names the fields each store's current declaration indexes, and a store
//   whose entry was read under others is asked.
// - A store whose lexicon outgrows {@link LIMIT} is asked every time: its
//   text admits nearly any word anyway.
// - Anything here failing asks every store, and the tracker hears.
import { admits, joined } from '@yaks/fts/lexicon'
import { type Field, fields } from '@yaks/fts/fields'
import { split } from '@yaks/fts'
import { storeName } from './directory.ts'
import { declarationOf } from './declaration.ts'
import type { Env } from './env.ts'
import type { Reach } from './reach.ts'
import { appVocab } from './vocab.ts'
import { caught } from './defects.ts'
import { Durable, type State } from '@yaks/durable-object/object'

/** Entries a lexicon keeps before it admits everything. */
export let LIMIT = 16_000

/** What one store's lexicon holds: the fields it was read under, whether the
 * whole store was read, and its sorted entries, or null for every word. */
export type Entry = { fields: string; whole: boolean; words: string[] | null }

/** What the object is asked: by stores and by the words a write brought. */
export type Lexicon = {
  admit(asked: { store: string; fields: string }[], words: string): Promise<
    string[]
  >
  grow(store: string, fields: string, words: string[]): Promise<boolean>
  put(store: string, fields: string, words: string[]): Promise<void>
  forget(store: string): Promise<void>
}

/** The binding: one object holds every store's lexicon. */
export type Lexicons = {
  idFromName(name: string): unknown
  get(id: unknown): Lexicon
}

type Kept = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<boolean>
}

/** The object's side, over its storage: one key per store. */
export let lexicon = (storage: Kept): Lexicon => {
  let held = new Map<string, Entry | null>()
  let read = async (store: string) => {
    if (!held.has(store)) {
      held.set(store, (await storage.get<Entry>(store)) ?? null)
    }
    return held.get(store)!
  }
  let keep = async (store: string, entry: Entry) => {
    held.set(store, entry)
    await storage.put(store, entry)
  }
  // The entry the words make, joined to what was read under the same fields.
  let added = (was: Entry | null, fields: string, words: string[]) => {
    let same = was?.fields == fields ? was : null
    if (same && !same.words) return null
    let all = joined(same?.words ?? [], words)
    return { same, words: all.length > LIMIT ? null : all }
  }
  return {
    admit: async (asked, words) => {
      let ask = await Promise.all(asked.map(async ({ store, fields }) => {
        let e = await read(store)
        return !e?.whole || e.fields != fields || !e.words ||
          admits(e.words, words)
      }))
      return asked.filter((_, i) => ask[i]).map((a) => a.store)
    },
    grow: async (store, fields, words) => {
      let was = await read(store)
      let next = added(was, fields, words)
      if (next && next.words?.length != next.same?.words?.length) {
        await keep(store, {
          fields,
          whole: !!next.same?.whole,
          words: next.words,
        })
      }
      return !!(was?.whole && was.fields == fields)
    },
    put: async (store, fields, words) => {
      let next = added(await read(store), fields, words)
      await keep(store, { fields, whole: true, words: next?.words ?? null })
    },
    forget: async (store) => {
      held.delete(store)
      await storage.delete(store)
    },
  }
}

/** The one object (index.ts `Lexicon`): it holds no graph, only one key per
 * store in its counted keys, which every app store's writes `grow`, and each
 * of its methods is an entry of its own. */
export class LexiconStore extends Durable implements Lexicon {
  #held: Lexicon
  constructor(ctx: State, _env: Env) {
    super(ctx, {
      report: (e, entry) => caught(e, { request: `lexicon ${entry}` }),
    })
    this.#held = lexicon(this.keys)
  }
  admit(asked: { store: string; fields: string }[], words: string) {
    return this.enter('admit', () => this.#held.admit(asked, words))
  }
  grow(store: string, fields: string, words: string[]) {
    return this.enter('grow', () => this.#held.grow(store, fields, words))
  }
  put(store: string, fields: string, words: string[]) {
    return this.enter('put', () => this.#held.put(store, fields, words))
  }
  forget(store: string) {
    return this.enter('forget', () => this.#held.forget(store))
  }
}

/** The one object, off its binding. */
export let lexiconOf = (ns: Lexicons): Lexicon =>
  ns.get(ns.idFromName('lexicon'))

/** The searchable fields a lexicon is read under, as one word. */
export let fieldsSaid = (searchable: Field[]): string =>
  searchable.map((f) => `${f.comp}.${f.prop}${f.on ? '@' + f.on : ''}`)
    .sort().join(' ')

// What each declaration indexes, by the key it is kept under: a declaration
// never changes once written (declaration.ts), so neither does this.
let said = new Map<string, Promise<string>>()
let SAID = 256

let indexed = (env: Env, r: Reach): Promise<string> => {
  let key = `${r.app.eid} ${r.app.source ?? ''} ${r.app.declaration ?? ''} ${
    r.app.version ?? ''
  }`
  let held = said.get(key)
  if (held) return held
  let next = declarationOf(env, r.space, r.app)
    .then((d) => fieldsSaid(fields(appVocab(d.vocab))))
  said.set(key, next)
  next.catch(() => said.get(key) == next && said.delete(key))
  if (said.size > SAID) said.delete(said.keys().next().value!)
  return next
}

// Words a lexicon can judge: plain words and quoted runs. Anything of the
// query grammar (`.doc`, `a=b`, `x | y`, a group) is asked of every store.
let plain = (words: string) =>
  split(words).every((w) => !/^[.!?(|&^-]/.test(w) && !/[=<>~&|()]/.test(w))

/**
 * The stores in reach a search for these words could find anything in. A
 * store with no whole lexicon under its current fields is always among them.
 */
export let narrowed = async (
  env: Env,
  reach: Reach[],
  words: string,
): Promise<Reach[]> => {
  if (!env.LEXICON || reach.length < 2 || !plain(words)) return reach
  try {
    let asked = await Promise.all(reach.map(async (r) => ({
      r,
      store: storeName(r.space, r.app),
      fields: await indexed(env, r).catch(() => ''),
    })))
    let ask = new Set(
      await lexiconOf(env.LEXICON).admit(
        asked.filter((a) => a.fields).map(({ store, fields }) => ({
          store,
          fields,
        })),
        words,
      ),
    )
    return asked.filter((a) => !a.fields || ask.has(a.store)).map((a) => a.r)
  } catch (e) {
    caught(e, { request: 'lexicon' })
    return reach
  }
}
