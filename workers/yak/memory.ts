// The platform's half of @yaks/memory (T-34473): where a space's memories are
// kept, how they are ranked here, and how one is written down — and, at the
// foot of the file, the four of those said as a plugin (plugin.ts, T-34602),
// which is how the host learns any of it. Nothing names this module from
// above: the words reach the directory's vocabulary, the two tools reach the
// roster and the page reaches the guide because `memoryPlugin` is in plugins.
//
// Where. In the directory — the platform's own store (door.ts
// PLATFORM_STORE), which is the one store a SPACE has. A memory is not an
// app's: the person said it about how they want things built, and it holds
// whether they are looking at the recipe app, the chores app or neither, so it
// belongs to the space every one of those apps is in. Every member of that
// space reads them; a writer writes them, the same seat every other write here
// takes.
//
// How they are ranked. By meaning: the directory keeps a vector beside every
// text it holds, a memory's sentence among them, and ranks words against the
// space's memories with an exact scan over its own vectors (embedding.ts,
// graph.ts `/meaning`). A save writes the row and nothing else; the store makes
// the vector once the write has committed. Words no vector answers — a memory
// saved a moment ago, a directory with no model bound (`wrangler dev`, the
// workerd probes) — rank themselves through the store's own full-text index
// over `doc`, which is where a memory's sentence lives. Nothing breaks either
// way.
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
import { page, type Plugin } from './plugin.ts'
import { titling, vouched, type Who } from './session.ts'
import { inSpace, type Row, SPACE, str, text, worded } from './tool.ts'
import { caught } from './sentry.ts'

/**
 * Ranking by meaning: the directory's vectors of the space's own memories,
 * nearest first. A directory that cannot answer — no model bound, an outage —
 * is a worse order, never a failed recall: it answers nothing, and the caller
 * ranks by the words instead.
 */
export let ranker = (env: Env): Ranker => async (words, scope) => {
  try {
    let hits = await meta(env).meaning(words, {
      within: line({ space: scope.space, limit: scope.limit }),
      limit: scope.limit,
    })
    return hits.map((h) => h.entity)
  } catch (e) {
    caught(e, { request: 'memory recall', space: scope.space })
    return []
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
 * Words that find nothing answer the newest rather than nothing at all. The
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
    let ids = await ranker(env)(said, { space: space.eid, limit })
    let held = ids.length
      ? ordered(
        ids,
        await read(env, line({ space: space.eid, limit, eids: ids })),
      )
      : []
    if (held.length) return held
    let hits = await read(env, line({ space: space.eid, limit, said }))
    if (hits.length) return hits
  }
  return await read(env, line({ space: space.eid, limit }))
}

/**
 * One memory kept: the person's words verbatim in the space's store, which
 * makes their vector once the write has committed. Answers the memory as it
 * was written.
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

// The rows, said as rows: the words each says about itself are in
// tools.yml under its name (tool.ts `worded`).
let MEMORY: Row[] = [
  // What the person said, kept as they said it (memory.ts, T-34473). Owner,
  // 2026-09-06: "any user instruction about *how* they like their apps built
  // (etc) could be saved. And we could incorporate our 'grapevine' problem
  // learnings by prompting the agent to save what the user said verbatim
  // along with only the required context to understand it." An app's NOTES.md
  // is the rules for one app, written by an agent; these are the person's own
  // sentences, space-wide, and every agent who can reach the space is handed
  // the newest few at connect (standing.ts).
  {
    name: 'memory_save',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        said: str(
          "the words to keep: a person's sentence as they said it, or a " +
            'note of your own',
        ),
        context: str(
          'a line or two saying what was being talked about, where the ' +
            'words do not stand on their own',
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
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        words: str(
          'what the memory is about, in a few words: "how the pages look", ' +
            '"measurements in a recipe". Leave it out for the newest',
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
]

/**
 * Memory, as what it contributes (plugin.ts): the words the directory keeps a
 * memory under, the two tools that write and read them, and the guide page
 * that teaches when to reach for which.
 *
 * The words come straight from the package — `memoryDoc` is @yaks/memory's own
 * document — so a memory means the same thing in a hosted space as it does on
 * a box. What this plugin adds is where they are loaded: the directory, which
 * is the one store a space has.
 *
 * The ranker is not a slot, and deliberately: it is the directory's own
 * vectors, which every store keeps, so a directory with no model bound ranks
 * by the words and nothing about the contribution changes.
 */
export let memoryPlugin: Plugin = {
  name: 'memory',
  vocab: [memoryDoc],
  pages: [page('memory')],
  tools: MEMORY.map(worded),
}
