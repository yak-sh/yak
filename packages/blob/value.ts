// Two tools that read a long text value in bounded pieces, through a reader the
// caller supplies. They exist because a model asked for a 200 KB body would
// otherwise get all of it: `graph_value_read` returns a slice and
// `graph_value_search` returns matching excerpts, both capped.
//
// A model reads each answer as text: a first line saying plainly where the
// piece lies, then the piece itself. Said as JSON, the piece would be a string
// with every quote and line break in it escaped, and a value that is itself
// JSON (a large tool result kept whole, @yaks/context) escaped a second time,
// which a model can barely read. Code reads the same pieces as data:
// `valueRange` and `valueSearch`.
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
import { CallError } from '@yaks/tools/errors'
import { address } from './store.ts'

export const VALUE_LIMIT = 8192
const chars = (s: string) => Array.from(s)
const integer = (v: unknown, fallback: number, max: number) => {
  const n = v == null ? fallback : v
  if (typeof n != 'number' || !Number.isSafeInteger(n) || n < 0 || n > max) {
    throw new CallError(
      'range',
      'Invalid range: expected integer from 0 to ' + max,
    )
  }
  return n
}

/**
 * Why a revision passed is not the value's: a hash of changed text shares
 * almost none of its digits with the old one, so one a few digits off is the
 * current revision copied wrong, and anything else is text that changed since,
 * or a revision copied far wrong. Either way the refusal names the current
 * revision, which is the next call that reads.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { address } from './store.ts'
 * import { stale } from './value.ts'
 *
 * let now = address('text'), was = address('text, before')
 * let typo = now.slice(0, 9) + (now[9] == '0' ? '1' : '0') + now.slice(10)
 * equal(stale(typo, now), `revision ${typo} is ${now} copied wrong: pass ${now}`)
 * equal(stale(was, now).startsWith(`revision ${was} is not this value's`), true)
 * ```
 */
export const stale = (passed: string, revision: string): string => {
  const off = [...revision].filter((c, i) => c != passed[i]).length
  return passed.length == revision.length && off <= 4
    ? `revision ${passed} is ${revision} copied wrong: pass ${revision}`
    : `revision ${passed} is not this value's, which is ${revision}: the ` +
      'text changed since the read that gave it, or the revision was copied ' +
      `wrong. Pass ${revision} to read the text as it is now; an offset ` +
      'from an older read may have moved'
}

/** A provider-neutral tool declaration: JSON Schema arguments in, text out. */
export type ValueTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string>
}

/** The reader every read goes through: the application's own authorized
 * entity reader. */
export type ValueReader = (entity: string) => Promise<Bundle | undefined>

/** A range of a text value: its code points `start` to `end` of `total`, where
 * the next range starts (null at the end), and the `revision` it was read at. */
export type ValueRange = {
  revision: string
  start: number
  end: number
  total: number
  next: number | null
  text: string
}

/** What a search of a text value found: each match's offset and the text
 * around it, the `revision` it searched, and where a search goes on from (null
 * once it found fewer matches than it was allowed). */
export type ValueSearch = {
  revision: string
  matches: { offset: number; text: string }[]
  next: number | null
}

const properties = {
  entity: { type: 'string' },
  component: { type: 'string' },
  property: { type: 'string' },
  revision: {
    type: 'string',
    description:
      'The revision an earlier read returned, copied exactly; if the text changed since, the read is refused, naming the current revision',
  },
  start: { type: 'integer', minimum: 0 },
}

const load = async (read: ValueReader, args: Record<string, unknown>) => {
  for (const key of ['entity', 'component', 'property']) {
    if (
      typeof args[key] != 'string' || !args[key] ||
      (args[key] as string).length > 1024
    ) throw new CallError('address', 'Invalid value address')
  }
  const row = await read(args.entity as string)
  const component = row && Object.hasOwn(row, args.component as string)
    ? row[args.component as string] as Comp
    : undefined
  const value = component && Object.hasOwn(component, args.property as string)
    ? component[args.property as string]
    : undefined
  if (typeof value != 'string') {
    throw new CallError('value', 'Value unavailable or not text')
  }
  const revision = address(value)
  if (args.revision != null && args.revision !== revision) {
    throw new CallError('revision', stale(String(args.revision), revision))
  }
  return { revision, text: chars(value) }
}

/** A range of a text value, read through `read`: `count` code points (2048, at
 * most {@link VALUE_LIMIT}) from `start` (0), refused when `revision` is passed
 * and the text is no longer that. */
export const valueRange =
  (read: ValueReader) =>
  async (args: Record<string, unknown>): Promise<ValueRange> => {
    const { text, revision } = await load(read, args)
    const start = integer(args.start, 0, text.length)
    const count = integer(args.count, 2048, VALUE_LIMIT)
    if (!count) throw new CallError('count', 'count must be positive')
    const end = Math.min(text.length, start + count)
    return {
      revision,
      start,
      end,
      total: text.length,
      next: end < text.length ? end : null,
      text: text.slice(start, end).join(''),
    }
  }

/** The literal, case-sensitive matches of `query` in a text value, read
 * through `read`: from `start` (0), at most `limit` (10, at most 20). */
export const valueSearch =
  (read: ValueReader) =>
  async (args: Record<string, unknown>): Promise<ValueSearch> => {
    const { text: points, revision } = await load(read, args)
    if (
      typeof args.query != 'string' || !args.query.length ||
      args.query.length > 256
    ) {
      throw new CallError(
        'query',
        'query must contain 1..256 UTF-16 code units',
      )
    }
    const start = integer(args.start, 0, points.length)
    const limit = integer(args.limit, 10, 20)
    if (!limit) throw new CallError('limit', 'limit must be positive')
    const text = points.slice(start).join('')
    const matches: { offset: number; text: string }[] = []
    let pos = 0, offset = start, consumed = 0
    while (matches.length < limit) {
      const at = text.indexOf(args.query, pos)
      if (at < 0) break
      offset += chars(text.slice(consumed, at)).length
      matches.push({
        offset,
        text: points.slice(Math.max(start, offset - 40), offset + 40).join(''),
      })
      consumed = at
      pos = at + args.query.length
    }
    return {
      revision,
      matches,
      next: matches.length == limit ? offset + chars(args.query).length : null,
    }
  }

// A range as a model reads it: where it lies, then the text as stored.
const said = (r: ValueRange): string =>
  `[Code points ${r.start} to ${r.end} of ${r.total}, revision ` +
  `${r.revision}; ${r.next == null ? 'the end' : `next start=${r.next}`}.]\n` +
  r.text

// How many matches a search found, as a sentence starts.
const counted = (n: number) =>
  !n ? 'No match' : n == 1 ? '1 match' : `${n} matches`

// A search as a model reads it: what it looked for and where it goes on, then
// a line for each match, its excerpt's line breaks and indents one space.
const found = (query: string, from: number, s: ValueSearch): string =>
  [
    `[${counted(s.matches.length)} for ${JSON.stringify(query)}` +
    `${from ? ` from code point ${from}` : ''}, revision ${s.revision}; ` +
    `${s.next == null ? 'no more' : `more from start=${s.next}`}.]`,
    ...s.matches.map((m) =>
      `at ${m.offset}: ${m.text.replace(/\s+/g, ' ').trim()}`
    ),
  ].join('\n')

/** The two tools, built over a reader. Pass the same authorized reader the
 * application's other graph tools use. Each answers a model in text: a line
 * saying where its piece lies, then the piece.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { address } from './store.ts'
 * import { valueTools } from './value.ts'
 *
 * let body = '[\n  {\n    "title": "Mossvale"\n  }\n]'
 * let [read, search] = valueTools(async (eid) =>
 *   eid == 'p1' ? { entity: { eid }, post: { body } } : undefined
 * )
 * let at = { entity: 'p1', component: 'post', property: 'body' }
 * let revision = address(body)
 * equal(
 *   await read.run({ ...at, start: 4, count: 26 }),
 *   `[Code points 4 to 30 of 35, revision ${revision}; next start=30.]\n` +
 *     '{\n    "title": "Mossvale"\n',
 * )
 * equal(
 *   await search.run({ ...at, query: 'Moss', start: 2 }),
 *   `[1 match for "Moss" from code point 2, revision ${revision}; no more.]\n` +
 *     'at 20: { "title": "Mossvale" } ]',
 * )
 * ```
 */
export const valueTools = (read: ValueReader): ValueTool[] => {
  const range = valueRange(read)
  const search = valueSearch(read)
  return [{
    name: 'graph_value_read',
    description:
      'Read a bounded range of any authorized graph text property, including blob-backed text. Zero-based Unicode code-point offsets; max 8192 characters. Answers a first line saying the range, total size, revision and next start, then the text itself, as stored. Does not read filesystem paths.',
    parameters: {
      type: 'object',
      properties: {
        ...properties,
        count: { type: 'integer', minimum: 1, maximum: VALUE_LIMIT },
      },
      required: ['entity', 'component', 'property'],
    },
    run: async (args) => said(await range(args)),
  }, {
    name: 'graph_value_search',
    description:
      'Literal case-sensitive search over an authorized graph text property. Answers a first line saying the revision and where to search on, then a line per match: its zero-based Unicode code-point offset and the text around it, line breaks shown as spaces. At most 20 matches. No regex execution.',
    parameters: {
      type: 'object',
      properties: {
        ...properties,
        query: { type: 'string', minLength: 1, maxLength: 256 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['entity', 'component', 'property', 'query'],
    },
    run: async (args) =>
      found(
        String(args.query),
        typeof args.start == 'number' ? args.start : 0,
        await search(args),
      ),
  }]
}
