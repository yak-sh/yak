// The Reads a turn opens without asking (T-2197). The Operator's persona
// names what only some turns need by id and a title saying when to open it
// (plugins/yaks.app/persona/base.md `reads`, @yaks/persona `voice`); a turn
// opens one with read_open (@yaks/harness `readOpen`). When the person's words
// are a strong match in meaning for a Read's title, its text is put beside
// them instead, as the earlier words recall puts there (operator.ts `before`),
// so that turn needs no call to open it. A message signing someone up always
// carries the Read on signing up.
import type { Bundle, Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { cosine, type Embedder } from '@yaks/embedding'
import type { Reads } from '@yaks/persona'
import { readsOf, readText } from '@yaks/harness/worn'
import { FLOORS } from './embedding.ts'

/** How many Reads one turn's words open at most. */
let MOST = 2

/** The Read a message signing someone up always carries
 * (plugins/yaks.app/persona/starting.md). */
export let SIGNING_UP = derivedEid('operator-persona|starting')

// A title's vector, kept while the isolate lives: the titles are few and
// change with a deploy, and the model with a new vector space.
let kept = new Map<string, Float32Array>()
let vector = async (embed: Embedder, text: string) => {
  let key = embed.model + '\n' + text
  let held = kept.get(key)
  if (held) return held
  let made = await embed.embed(text)
  kept.set(key, made)
  return made
}

let titleOf = (b: Bundle) =>
  String((b.doc as { title?: unknown } | undefined)?.title ?? '')

/** The Reads `words` open: those whose title they match in meaning at the
 * recall floor or nearer (embedding.ts `FLOORS`), nearest first, and on a
 * signing-up turn the Read on signing up. */
export let opened = async (
  names: Bundle[],
  words: string,
  embed: Embedder | null,
  signup = false,
): Promise<Bundle[]> => {
  let forced = signup ? names.filter((b) => b.entity.eid == SIGNING_UP) : []
  if (!embed || !words.trim() || !names.length) return forced
  let said = await embed.embed(words)
  let near = await Promise.all(
    names.map(async (b) => ({
      b,
      near: cosine(said, await vector(embed, titleOf(b))),
    })),
  )
  let matched = near.filter((n) => n.near >= FLOORS.floor)
    .sort((a, b) => b.near - a.near).map((n) => n.b)
  return [...new Set([...forced, ...matched])].slice(0, MOST + forced.length)
}

/** The note beside a turn's words that carries the Reads they open, or
 * none. */
export let readsNote = async (
  g: Graph,
  bases: Reads,
  session: string,
  words: string,
  embed: Embedder | null,
  signup = false,
): Promise<string | undefined> => {
  let names = await readsOf(g, session, { bases })
  let open = await opened(names, words, embed, signup)
  if (!open.length) return
  return 'Opened from your Reads for these words; follow it:\n\n' +
    open.map((b) => readText(g, b)).join('\n\n---\n\n')
}
