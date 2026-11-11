import { sessionRows } from './session-lens.ts'
// yaks.app's reach (@yaks/reach): every store a caller can read, each one a
// member of one composition. A read that names no app is one question asked
// of every store, answered as one bundle per eid, and a write sends each
// component to the store that word lives in; the fan-out, the split and the
// merge are the package's. What is here is the door each member is: a
// store's Durable Object, asked at `GET /query` and `POST /apply`, vouched for
// the caller, and its vocabulary as the directory last accepted it. tools.ts
// owns which stores are in reach.
import { listed, names, type Row, STAMPS } from './listing.ts'
import type { Bundle } from '@yaks/graph'
import { requested } from '@yaks/graph/bundle'
import { sha256 } from '@yaks/graph'
import { IDEMPOTENCY } from './door.ts'
import { durable, INTENT } from './writes.ts'
import { misfit } from '@yaks/graph/errors'
import {
  type App,
  appStore,
  META_STORE,
  type Space,
  storeName,
} from './directory.ts'
import type { Env } from './env.ts'
import { vouched, type Who } from './session.ts'
import { edits, mode } from '@yaks/member'
import { declarationOf } from './declaration.ts'
import { compile, lensesIn } from '@yaks/lens'
import { lensDocAt, spoken as lensSpoken } from './lenses.ts'
import {
  appKeywords,
  appVocab,
  lentDocs,
  packagesOf,
  platformDocs,
} from './vocab.ts'
import { once } from '@yaks/fp'
import { bareLine } from '@yaks/query'
import { type Ask, type Member, reach as composition } from '@yaks/reach'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { refuse, rejected } from './tool.ts'
import { caught } from './defects.ts'
import { said as told } from './writes.ts'
import { answered } from './meta.ts'
import { sandboxed } from './installed.ts'

export type { Ask }

// The words the PLATFORM says in every store, including its vocabulary and
// journal. A word outside this list was declared by an app, which is what
// makes it the most specific thing said about a row. Composed on first use.
let core = once((): Vocab => appVocab())

// The directory has no app-owned vocab.json for `/vocab` to answer: its own
// words are the documents shipped with the platform. Keep only the words not
// already in every store, the same shape an app's `/vocab` answers, so routing
// and alias derivation see `secret.name` and the rest of the directory's own
// identities without treating shared words as though only it declared them.
let platformWords = once((): VocabDoc => ({
  title: 'platform',
  $defs: Object.fromEntries(
    platformDocs().flatMap((doc) => Object.entries(doc.$defs ?? {}))
      .filter(([name]) => !core().all.includes(name)),
  ),
}))

// One store in reach: the app, the space it is in, and who the caller is
// there. `at` is what a bundle names as the component's home.
export type Reach = {
  space: Space
  app: App
  who: Who
  /** This store's caller vocabulary, retained throughout a composed read. */
  headers?: Record<string, string>
}

export let at = (r: { space: Space; app: App }) =>
  `${r.space.slug}/${r.app.slug}`

// The space's language, and the platform's listing rule: a stamp leaves a
// listing unless the line names it (listing.ts `listed`), so one fetched only
// to order by leaves the answer too. A store left out of a read is reported
// with its space and app, which is what its `at` spells.
let fan = once(() =>
  composition({
    core: core(),
    // And the words the apps' `"platform"` dependencies lend, beneath their
    // own.
    union: (defs, docs) =>
      loadVocab(
        [
          ...core().docs,
          ...lentDocs({
            $defs: defs,
            packages: [...new Set(docs.flatMap(packagesOf))].sort(),
          }),
          { title: 'space', $defs: defs },
        ],
        appKeywords,
      ),
    hidden: (comp, line) => STAMPS.includes(comp) && !names(line, comp),
    silent: (e, m) => {
      let [space, app] = m.at.split('/')
      caught(e, { request: 'reach', space, app })
    },
  })
)

// One store as a member: its /query and /apply doors, vouched, and its words.
//
// A read is answered by the listing rule every other door answers by
// (listing.ts), cut by `said`, the line the caller asked: a composed read asks
// each store a part of the line and then gathers the bundle by `id=`, and the
// listing rule applied to those words hid the stamps the caller had named
// (C-32800 item 4). The question carries the same door's screen an app's page
// asks with (listing.ts `asking`), because an app's store keeps person rows as
// its own bookkeeping, and a person titled with what to call them matches
// `.doc` like any row. A refusal is thrown as the store's own sentence, after
// the store's address.
//
// A write's `check` rehearses the batch: every phase runs and the transaction
// is rolled back (@yaks/graph `check`). The access rule is the page's: an
// owner or editor writes, and so does anyone at all when the app is open.
let memberOf = (
  env: Env,
  r: Reach,
  headers: Record<string, string> = {},
): Member => ({
  at: at(r),
  name: r.app.slug,
  space: r.space.slug,
  sandboxed: sandboxed(r.app),
  vocab: () => vocabAt(env, r.space, r.app, r.headers),
  read: async (line, { said, live = false } = {}) => {
    let asked = bareLine(line)
    let door = appStore(env.STORE, r.space, r.app, env)
    let bundles = await door.consume(
      `/query?q=${encodeURIComponent(asked)}${live ? '&live=1' : ''}&listing=1`,
      async (res) => {
        // Said with the store's address, as a write's refusal is: in a read of
        // several, it says whose words the sentence speaks of.
        if (!res.ok) throw rejected(res.status, `${at(r)}: ${await told(res)}`)
        return await res.json()
      },
      {},
      { ...vouched(r.who), ...r.headers },
    )
    return Array.isArray(bundles)
      ? listed(bundles as Row[], said ?? asked) as Bundle[]
      : bundles
  },
  apply: (entities, check) => {
    if (!edits(mode(r.app.access), r.who.role)) {
      throw refuse('access', `not a writer of ${at(r)}`)
    }
    let door = appStore(env.STORE, r.space, r.app, env)
    return door.consume(`/apply${check ? '?check=1' : ''}`, async (res) => {
      // A write the store's log kept (writes.ts) lands later, in order: the
      // agent is told so rather than that it failed, so it does not send it
      // twice.
      if (res.status == 202) {
        throw refuse('unavailable', `${at(r)}: ${await told(res)}`)
      }
      if (!res.ok) {
        // A write that did not fit the store's words still says so, so the
        // page's door can file it as the app's break (apps.ts `mistaken`).
        let no = await answered(res)
        let e = rejected(res.status, `${at(r)}: ${no.message}`)
        throw misfit(no) ? Object.assign(e, { misfit: true }) : e
      }
      return await res.json() as Bundle[]
    }, {
      method: 'POST',
      body: JSON.stringify(entities),
    }, { ...vouched(r.who), ...r.headers, ...headers })
  },
})

// The reach as members, and the one named among them: routing goes by
// identity, so a named store already in reach is that very member.
let membersOf = (
  env: Env,
  reach: Reach[],
  named?: Reach,
  headers?: Record<string, string>,
) => {
  let members = reach.map((r) => memberOf(env, r, headers))
  let i = named ? reach.indexOf(named) : -1
  let one = named && (i >= 0 ? members[i] : memberOf(env, named, headers))
  return { members, named: one }
}

/** The read, whole (@yaks/reach `read`): one store's own answer, or every
 * store's merged into one bundle per eid. */
export let read = (
  env: Env,
  reach: Reach[],
  line: string,
  live = false,
): Promise<unknown> => fan().read(membersOf(env, reach).members, line, live)

/** These eids, whole, out of every store that holds a piece of one. */
export let composed = (
  env: Env,
  reach: Reach[],
  eids: string[],
  ask: Ask = {},
) => fan().composed(membersOf(env, reach).members, eids, ask)

// The words one store declares as its own — its `vocab.json` as the store last
// accepted it (T-32502), read back through the same door the deploy wrote it
// at and loaded as the document it means (vocab.ts `meant`).
// A component nobody declares is the platform's, and every store speaks it. A
// store that cannot answer says nothing, which reads as an app with no words
// of its own.
//
// Words are release metadata. Discovery and schema translation must never
// wake a Store merely to ask which declaration its directory pointer selects.
export let vocabAt = async (
  env: Env,
  space: Space,
  app: App,
  headers: Record<string, string> = {},
): Promise<VocabDoc> => {
  if (at({ space, app }) == META_STORE) return platformWords()
  let doc = (await declarationOf(env, space, app)).vocab
  let speaks =
    lensSpoken(new Request('https://store/vocab', { headers })).speaks
  if (!speaks) return doc
  let docs = compile([
    ...sessionRows(),
    ...lensesIn([lensDocAt(storeName(space, app), doc)]),
  ], speaks)
    .schema(appVocab(doc).docs)
  let own = new Set(Object.keys(doc.$defs ?? {}))
  return {
    ...doc,
    $defs: Object.fromEntries(
      docs.flatMap((d) =>
        Object.entries(d.$defs ?? {}).filter(([name]) => own.has(name))
      ),
    ),
  }
}

/** The batch, split by component into one part per store. */
export let routed = async (
  env: Env,
  reach: Reach[],
  named: Reach | undefined,
  bundles: Bundle[],
  key?: string,
) => {
  let { members, named: one } = membersOf(env, reach, named)
  let stores = new Map(members.map((m, i) => [m, reach[i]]))
  if (one && named) stores.set(one, named)
  let { parts, aliases } = await fan().routed(members, one, bundles, key)
  return {
    parts: parts.map(({ member, entities }) => ({
      r: stores.get(member)!,
      entities,
    })),
    aliases,
  }
}

// The write, whole (@yaks/reach `written`): routed, rehearsed everywhere,
// then committed.
export let written = (
  env: Env,
  reach: Reach[],
  named: Reach | undefined,
  bundles: Bundle[],
  headers: Record<string, string> = {},
  check = false,
): Promise<{
  bundles: Bundle[]
  aliases: Record<string, string>
  where: string
}> => {
  // Every `$` word the wire carries. The split rebuilds each part out of the
  // keys it knows, so one it does not know would be dropped on the way to a
  // store and the caller would never hear about it — `$num: true` coming back
  // as a write with no number and no word why is exactly what @yaks/graph
  // `requested` refuses, said here because this door is where it would be
  // lost. `$app` is the door's own (agent.ts `aimed`), which is why it is
  // named beside the graph's.
  requested(bundles, ['$app'])
  let key = new Headers(headers).get(IDEMPOTENCY)
  if (durable(key)) {
    headers = { ...headers, [INTENT]: sha256(JSON.stringify(bundles)) }
  }
  let { members, named: one } = membersOf(env, reach, named, headers)
  return fan().written(members, one, bundles, {
    key: durable(key) ? key! : undefined,
    check,
  })
}
