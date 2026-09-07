// The platform's half of @yaks/memory (T-34473): where a space's memories are
// kept, how they are ranked here, and how one is written down — and, at the
// foot of the file, the four of those said as a PLUGIN (plugin.ts, T-34602),
// which is how the host learns any of it. Nothing names this module from
// above: the words reach the directory's vocabulary, the two tools reach the
// roster and the page reaches the guide because `memoryPlugin` is in PLUGINS.
//
// WHERE. In the directory — the platform's own store (door.ts
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
  memoryDoc,
  ordered,
  passage,
  type Ranker,
  saved,
} from '@yaks/memory'
import type { Bundle } from '@yaks/graph'
import type { Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import type { Plugin } from './plugin.ts'
import { titling, vouched, type Who } from './session.ts'
import { inSpace, SPACE, str, text } from './tool.ts'

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

// ---- the plugin (T-34602) --------------------------------------------------

/**
 * Memory, as what it CONTRIBUTES (plugin.ts): the words the directory keeps a
 * memory under, the two tools that write and read them, and the guide page
 * that teaches when to reach for which.
 *
 * The words come straight from the package — `memoryDoc` is @yaks/memory's own
 * document — so a memory means the same thing in a hosted space as it does on
 * a box. What this plugin adds is WHERE they are loaded: the directory, which
 * is the one store a space has.
 *
 * The ranker is not a slot, and deliberately: it is read by `memories` above
 * out of bindings this host happens to hold, so a host with no Vectorize ranks
 * by the words and nothing about the contribution changes.
 */
export let memoryPlugin: Plugin = {
  name: 'memory',
  vocab: [memoryDoc],
  pages: [{
    slug: 'memory',
    title: 'What the person said',
    description:
      'memory_save and memory_recall: keeping what the person said about how ' +
      'they want things done, in their own words rather than your summary of ' +
      'them — what belongs in a memory, what context is for and what it is ' +
      'not, when to reach for each tool, how a recall is ranked, and how a ' +
      "memory differs from an app's AGENTS.md.",
    brief: 'the words a person wants remembered',
  }],
  tools: [
    // What the person said, kept as they said it (memory.ts, T-34473). Owner,
    // 2026-09-06: "any user instruction about *how* they like their apps built
    // (etc) could be saved. And we could incorporate our 'grapevine' problem
    // learnings by prompting the agent to save what the user said verbatim
    // along with only the required context to understand it." An AGENTS.md is
    // the rules for ONE app, written by an agent; these are the person's own
    // sentences, space-wide, and every agent who can reach the space is handed
    // the newest few at connect (standing.ts).
    {
      name: 'memory_save',
      title: 'Keep what they said',
      destructive: false,
      description:
        'Keep what the person said about how they want something built or ' +
        'handled — their words, as they said them. Reach for it the moment ' +
        'they state a preference, a standard, a taste, a way of working, a ' +
        'thing they never want done again: "use grams, never cups", "keep it ' +
        'soft, not technical", "always show me the link". Save the SENTENCE, ' +
        'verbatim — never your summary of it, never a tidied-up version, ' +
        'never what you concluded from it. A summary can only lose what they ' +
        'said, and nobody can get it back. Add context only where the words ' +
        'are unreadable without it — one line saying what was being talked ' +
        'about, and no more; the words themselves carry the rest. It is kept ' +
        'for the whole space, so everyone working there sees it, and every ' +
        'agent that connects afterwards is handed the newest few. Rules for ' +
        "ONE app go in that app's AGENTS.md instead (guide page instructions).",
      input: {
        type: 'object',
        properties: {
          said: str(
            'the words the person used, exactly as they used them — their ' +
              'sentence, not a paraphrase of it',
          ),
          context: str(
            'the one line needed to understand those words later — what was ' +
              'being talked about when they said it. Two lines at most, and ' +
              'leave it out where the words stand on their own',
          ),
          about: str(
            'the app they were talking about, by slug, if there was one',
          ),
          space: SPACE,
        },
        required: ['said'],
      },
      run: async (ctx, args) => {
        let { space, who } = await inSpace(ctx, args, true)
        let kept = await remember(ctx.env, ctx.dir, space, who, {
          said: text(args.said, 'said'),
          context: args.context == null ? '' : String(args.context),
          about: args.about == null ? '' : String(args.about),
        })
        return {
          space,
          text: `Kept, in their words, for everyone in ${space.slug}:\n\n` +
            `"${kept.said}"${kept.context ? `\n${kept.context}` : ''}\n\n` +
            'Every agent that connects here is handed it; memory_recall ' +
            'finds it by what it is about.',
        }
      },
    },
    {
      name: 'memory_recall',
      title: 'What they have said',
      readOnly: true,
      description:
        'What the person has said about how they want things done, in their ' +
        'own words, ranked by what your words are about. Ask BEFORE building ' +
        'or changing an app, and whenever a choice is theirs to have made — ' +
        'how a page should look, what a thing should be called, how they want ' +
        'to be told about something. The newest few ride on every ' +
        'connection already; this is how the rest are found. Answers each ' +
        'memory whole, with the line of context saved beside it.',
      input: {
        type: 'object',
        properties: {
          words: str(
            'what you are about to do or decide, in a few words — "how should ' +
              'the pages look", "measurements in a recipe". Leave it out for ' +
              'the newest',
          ),
          limit: {
            type: 'number',
            description: 'how many at most (default 8)',
          },
          space: SPACE,
        },
      },
      run: async (ctx, args) => {
        let { space } = await inSpace(ctx, args)
        let said = args.words == null ? '' : String(args.words)
        let held = await memories(ctx.env, space, {
          said,
          limit: args.limit == null ? undefined : Number(args.limit),
        })
        if (!held.length) {
          return {
            space,
            text: `Nothing has been kept in ${space.slug} yet. When they say ` +
              'how they want something built or handled, memory_save keeps ' +
              'their words.',
          }
        }
        return {
          space,
          text: held.map((m) =>
            `"${m.said}"${m.context ? `\n  ${m.context}` : ''}` +
            `${m.about ? `\n  about the ${m.about} app` : ''}` +
            `${
              m.by ? `\n  — ${m.by}${m.at ? `, ${m.at.slice(0, 10)}` : ''}` : ''
            }`
          ).join('\n\n'),
        }
      },
    },
  ],
}
