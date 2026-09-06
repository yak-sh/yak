// The platform's half of @yaks/memory (T-34473): where a space's memories are
// kept, how they are ranked here, and how one is written down.
//
// WHERE. In the directory — the platform's own store (vocab.ts
// PLATFORM_STORE), which is the one store a SPACE has. A memory is not an
// app's: the person said it about how they want things built, and it holds
// whether they are looking at the recipe app, the chores app or neither, so it
// belongs to the space every one of those apps is in. Every member of that
// space reads them; a writer writes them, the same seat every other write here
// takes.
//
// HOW THEY ARE RANKED. On Cloudflare, by MEANING: Workers AI embeds the words,
// Vectorize answers which memories are nearest, filtered to the space. That
// index is made once, outside a deploy —
//
//   wrangler vectorize create yak-memories --dimensions=768 --metric=cosine
//
// — and until somebody has, or wherever the bindings are absent (`wrangler
// dev`, the workerd probes), there is no ranker and the WORDS rank themselves
// through the store's own full-text index over `doc`, which is where a
// memory's sentence lives. One line in the log says which, and nothing breaks.
//
// A save upserts the vector after the row is written, and never fails the
// write: a memory the vector service did not hear about is still findable by
// its words, and a memory refused because an embedding call timed out is the
// person's sentence lost.
import {
  heard,
  LAST,
  line,
  type Memory,
  ordered,
  passage,
  type Ranker,
  saved,
} from '@yaks/memory'
import type { Bundle } from '@yaks/graph'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { titling, vouched, type Who } from './session.ts'

/** The Vectorize index, and the Workers AI model whose vectors it holds. */
export let INDEX = 'yak-memories'
export let MODEL = '@cf/baai/bge-base-en-v1.5'

// The words as one vector, or nothing where the model is not bound or did not
// answer in the shape it documents. Never throws: every caller has a way to
// carry on without it.
let vector = async (env: Env, text: string): Promise<number[] | null> => {
  if (!env.AI) return null
  try {
    let said = await env.AI.run(MODEL, { text: [text] }) as {
      data?: number[][]
    }
    let one = said?.data?.[0]
    return Array.isArray(one) && one.length ? one : null
  } catch {
    return null
  }
}

/**
 * Ranking by meaning, where this host can: Vectorize over the space's own
 * memories. Absent — no index bound, no model bound — nothing is answered and
 * the caller ranks by the words instead.
 */
export let ranker = (env: Env): Ranker | undefined => {
  let index = env.VECTORIZE
  if (!index || !env.AI) return undefined
  return async (words, scope) => {
    let asked = await vector(env, words)
    if (!asked) return []
    // A vector service that is bound and cannot answer — an index nobody has
    // created yet, `wrangler dev` refusing a binding it only serves remotely,
    // an outage — is a worse ORDER, never a failed recall: the caller ranks by
    // the words instead.
    try {
      let found = await index.query(asked, {
        topK: scope.limit,
        filter: { space: scope.space },
      })
      return (found?.matches ?? []).map((m) => m.id)
    } catch (e) {
      console.log(`memory: ${INDEX} did not answer — ${e}`)
      return []
    }
  }
}

// The vector for one memory, filed under its own eid with the space beside it,
// so a query is answered within one space and a deleted memory is one id to
// forget. Failure is a log line: the row is already written.
let filed = async (env: Env, eid: string, space: string, said: string) => {
  let index = env.VECTORIZE
  if (!index) return
  try {
    let values = await vector(env, said)
    if (!values) return
    await index.upsert([{ id: eid, values, metadata: { space } }])
  } catch (e) {
    console.log(`memory: ${eid} was not filed — ${e}`)
  }
}

/** The memories a filter line answered, as memories. */
let read = async (env: Env, q: string): Promise<Memory[]> =>
  (await meta(env).query(q) as Bundle[]).map(heard)

/**
 * A space's memories, closest first where words were asked about and newest
 * first where they were not. The ranker answers ids; the store answers the
 * memories themselves, so a rank never decides what a caller may read — the
 * space on the line does.
 *
 * Words that find nothing answer the NEWEST rather than nothing at all. The
 * fallback is a full-text index, which matches the phrase and not the meaning
 * of it, so "how should the pages look" over a store that holds "keep it soft,
 * not technical" matches no word — and an agent told nothing has been kept
 * goes on to build against preferences that are sitting right there.
 */
export let memories = async (
  env: Env,
  space: Space,
  ask: { said?: string; limit?: number } = {},
): Promise<Memory[]> => {
  let limit = ask.limit ?? LAST
  let said = (ask.said ?? '').trim()
  if (said) {
    let rank = ranker(env)
    if (rank) {
      let ids = await rank(said, { space: space.eid, limit })
      let held = ids.length
        ? ordered(
          ids,
          await read(env, line({ space: space.eid, limit, eids: ids })),
        )
        : []
      if (held.length) return held
    } else {
      console.log(
        'memory: no vector service bound — recall is ranking by words',
      )
    }
    let hits = await read(env, line({ space: space.eid, limit, said }))
    if (hits.length) return hits
  }
  return await read(env, line({ space: space.eid, limit }))
}

/**
 * One memory kept: the person's words verbatim in the space's store, then the
 * vector beside them. Answers the memory as it was written.
 */
export let remember = async (
  env: Env,
  dir: { nameAt: (person: string) => Promise<string | null> },
  space: Space,
  who: Who,
  m: { said: string; context?: string; about?: string },
): Promise<Memory> => {
  let eid = crypto.randomUUID()
  let batch = saved({ eid, space: space.eid, ...m })
  let wrote = await meta(env).apply(batch, {
    ...vouched(who),
    ...await titling(dir, who.person),
  })
  await filed(env, eid, space.eid, m.said.trim())
  return heard(wrote.find((b) => b.entity.eid == eid) ?? batch[0])
}

/**
 * A space's memories as the passage every agent reads at connect (T-34474).
 *
 * The heading is named after whoever spoke most recently, off the byline the
 * store already answered with — a space is almost always one person, and the
 * entries name anybody else who spoke. So no name is looked up for this.
 */
export let told = async (env: Env, space: Space): Promise<string> => {
  // One more than the passage shows, so it knows there are more to say
  // without counting them.
  let held = await memories(env, space, { limit: LAST + 1 })
  return passage({ name: held[0]?.by ?? '', space: space.slug }, held)
}
