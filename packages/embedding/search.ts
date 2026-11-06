// A person's words in, the nearest stored texts out. The embedder makes the
// query vector; the stored vectors and their source text stay in this package.

import type { Eid } from '@yaks/graph'
import type { BindOpts, Screen, Statements } from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'
import type { Embedder } from './embedder.ts'
import type { Field } from './fields.ts'
import { nearest } from './near.ts'
import { sources } from './sweep.ts'
import { screened, visibleVectors } from './visibility.ts'

/** One match by meaning. Its excerpt is unmarked: the words need not occur. */
export type Hit = {
  entity: Eid
  similarity: number
  excerpt: string
}

export type MeaningOpts = {
  /** Vocabulary and visibility of the person asking, when the read is scoped. */
  vocab?: Vocab
  visibility?: BindOpts['visibility']
  limit?: number
  floor?: number
  /** the entities a hit must be among, as a statement selecting their ids
   * (@yaks/sql `Screen`): asked for once the words are embedded, so it is
   * compiled against the rows the search then reads */
  screen?: Screen
}

/** A short piece of the text that made an entity's vector. */
export let excerpt = (text: string, size = 180): string => {
  let line = '', gap = false
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      gap = !!line
      continue
    }
    if (gap) line += ' '
    gap = false
    line += text[i]
    if (line.length > size) break
  }
  if (line.length <= size) return line
  let cut = line.slice(0, size).replace(/\s+\S*$/, '')
  return `${cut || line.slice(0, size)}…`
}

/** Search stored vectors with new words, then read only the hits' source text.
 * `fields` must be the configured fields, resolved through any derived text
 * expressions that fed the stored vectors. */
export let meaning = async (
  db: Statements,
  fields: Field[],
  embedder: Embedder,
  words: string,
  opts: MeaningOpts = {},
): Promise<Hit[]> => {
  if (!words.trim() || !fields.length || (opts.limit ?? 20) <= 0) return []
  if (opts.visibility && !opts.vocab) {
    throw new Error('meaning search with visibility requires a vocabulary')
  }
  let visible = opts.vocab
    ? visibleVectors(opts.vocab, fields, opts.visibility)
    : undefined
  let vector = await embedder.embed(words)
  let found = nearest(db, vector, {
    model: embedder.model,
    limit: opts.limit ?? 20,
    floor: opts.floor,
    within: screened(opts.screen?.(), visible),
  })
  if (!found.length) return []
  let text = new Map(
    sources(db, fields, found.map((h) => h.owner))
      .map((s) => [s.owner, excerpt(s.text)]),
  )
  return found.map((h) => ({
    entity: h.entity,
    similarity: h.similarity,
    excerpt: text.get(h.owner) ?? '',
  }))
}
