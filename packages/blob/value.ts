// Two tools that read a long text value in bounded pieces, through a reader the
// caller supplies. They exist because a model asked for a 200 KB body would
// otherwise get all of it: `graph_value_read` returns a slice and
// `graph_value_search` returns matching excerpts, both capped.
//
// The reader is the caller's own authorized entity reader, so these tools add
// no access of their own: they never take a filesystem path or a raw blob
// address, and they read a graph property by name like any other tool. An
// optional `revision` is the SHA-256 of the text the caller last saw, so a
// value that changed underneath fails instead of returning a mix of two
// versions.
//
// Neither tool exposes a raw blob address, and neither bypasses graph access
// control.

import type { Bundle, Comp } from '@yaks/graph'
import { address } from './store.ts'

export const VALUE_LIMIT = 8192
const chars = (s: string) => Array.from(s)
const integer = (v: unknown, fallback: number, max: number) => {
  const n = v == null ? fallback : v
  if (typeof n != 'number' || !Number.isSafeInteger(n) || n < 0 || n > max) {
    throw new Error('Invalid range: expected integer from 0 to ' + max)
  }
  return n
}

/** A provider-neutral tool declaration: JSON Schema arguments in, text out. */
export type ValueTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string>
}

/** The two tools, built over a reader. Pass the same authorized reader the
 * application's other graph tools use. */
export const valueTools = (
  read: (entity: string) => Promise<Bundle | undefined>,
): ValueTool[] => {
  const properties = {
    entity: { type: 'string' },
    component: { type: 'string' },
    property: { type: 'string' },
    revision: {
      type: 'string',
      description:
        'Optional SHA-256 of expected UTF-8 text; mismatches fail instead of reading newer content',
    },
    start: { type: 'integer', minimum: 0 },
  }
  const load = async (args: Record<string, unknown>) => {
    for (const key of ['entity', 'component', 'property']) {
      if (
        typeof args[key] != 'string' || !args[key] ||
        (args[key] as string).length > 1024
      ) throw new Error('Invalid value address')
    }
    const row = await read(args.entity as string)
    const component = row && Object.hasOwn(row, args.component as string)
      ? row[args.component as string] as Comp
      : undefined
    const value = component && Object.hasOwn(component, args.property as string)
      ? component[args.property as string]
      : undefined
    if (typeof value != 'string') {
      throw new Error('Value unavailable or not text')
    }
    const revision = address(value)
    if (args.revision != null && args.revision !== revision) {
      throw new Error('Value revision changed')
    }
    return { revision, text: chars(value) }
  }
  return [{
    name: 'graph_value_read',
    description:
      'Read a bounded range of any authorized graph text property, including blob-backed text. Zero-based Unicode code-point offsets; max 8192 characters. Returns revision, total size, and next offset. Does not read filesystem paths.',
    parameters: {
      type: 'object',
      properties: {
        ...properties,
        count: { type: 'integer', minimum: 1, maximum: VALUE_LIMIT },
      },
      required: ['entity', 'component', 'property'],
    },
    run: async (args: Record<string, unknown>) => {
      const { text, revision } = await load(args)
      const start = integer(args.start, 0, text.length)
      const count = integer(args.count, 2048, VALUE_LIMIT)
      if (!count) throw new Error('count must be positive')
      let end = Math.min(text.length, start + count)
      // JSON escapes control characters, so the serialized response can be much
      // larger than the slice; halve the slice until the response fits too.
      while (JSON.stringify(text.slice(start, end).join('')).length > 12000) {
        end = start + Math.floor((end - start) / 2)
      }
      return JSON.stringify({
        revision,
        start,
        end,
        total: text.length,
        next: end < text.length ? end : null,
        text: text.slice(start, end).join(''),
      })
    },
  }, {
    name: 'graph_value_search',
    description:
      'Literal case-sensitive search over an authorized graph text property. Returns bounded excerpts and zero-based Unicode code-point offsets, at most 20 matches. No regex execution.',
    parameters: {
      type: 'object',
      properties: {
        ...properties,
        query: { type: 'string', minLength: 1, maxLength: 256 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['entity', 'component', 'property', 'query'],
    },
    run: async (args: Record<string, unknown>) => {
      const { text: points, revision } = await load(args)
      if (
        typeof args.query != 'string' || !args.query.length ||
        args.query.length > 256
      ) throw new Error('query must contain 1..256 UTF-16 code units')
      const start = integer(args.start, 0, points.length)
      const limit = integer(args.limit, 10, 20)
      if (!limit) throw new Error('limit must be positive')
      const text = points.slice(start).join('')
      const matches: { offset: number; text: string }[] = []
      let pos = 0, offset = start, consumed = 0
      while (matches.length < limit) {
        const at = text.indexOf(args.query, pos)
        if (at < 0) break
        offset += chars(text.slice(consumed, at)).length
        matches.push({
          offset,
          text: points.slice(Math.max(start, offset - 40), offset + 40).join(
            '',
          ),
        })
        consumed = at
        pos = at + args.query.length
      }
      return JSON.stringify({
        revision,
        matches,
        next: matches.length == limit
          ? offset + chars(args.query).length
          : null,
      })
    },
  }]
}
