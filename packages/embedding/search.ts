// A person's words in, the nearest stored texts out. The embedder makes the
// query vector; the stored vectors and their source text stay in this package.

import type { Eid } from '@yaks/graph'
import type { Driver, Raw } from '@yaks/sql'
import type { Embedder } from './embedder.ts'
import type { Field } from './fields.ts'
import { nearest } from './near.ts'
import { sources } from './sweep.ts'

/** One match by meaning. Its excerpt is unmarked: the words need not occur. */
export type Hit = {
  entity: Eid
  similarity: number
  excerpt: string
}

export type MeaningOpts = {
  limit?: number
  floor?: number
  /** a statement selecting the eids a hit must be among */
  screen?: Raw
}

/** A short piece of the text that made an entity's vector. */
export let excerpt = (text: string, size = 180): string => {
  let line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= size) return line
  let cut = line.slice(0, size).replace(/\s+\S*$/, '')
  return `${cut || line.slice(0, size)}…`
}

/** Search stored vectors with new words, then read only the hits' source text.
 * `fields` must be the configured fields, resolved through any derived text
 * expressions that fed the stored vectors. */
export let meaning = async (
  db: Driver,
  fields: Field[],
  embedder: Embedder,
  words: string,
  opts: MeaningOpts = {},
): Promise<Hit[]> => {
  if (!words.trim() || !fields.length || (opts.limit ?? 20) <= 0) return []
  let vector = await embedder.embed(words)
  let found = nearest(db, vector, {
    model: embedder.model,
    limit: opts.limit ?? 20,
    floor: opts.floor,
    within: opts.screen,
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
