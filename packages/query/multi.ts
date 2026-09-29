// A multi-entity match is a sequence of ordinary entity queries. Brackets turn
// a sequence into a collection, so its matches belong to the surrounding
// binding rather than multiplying it. This is syntax only: each leaf is parsed
// by the same query parser as every other entity match.

import { type And } from './ast.ts'
import { parse, type ParseOpts } from './parse.ts'

export type MatchPart =
  | { kind: 'pattern'; query: And }
  | { kind: 'collection'; parts: MatchPart[] }

// Semicolons separate entities only outside quotes, path qualifiers, and
// collection brackets. A bracketed part is parsed again, so nesting needs no
// separate grammar.
let split = (source: string): string[] => {
  let parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let i = 0; i < source.length; i++) {
    let c = source[i]
    if (quote) {
      if (c == '\\') i++
      else if (c == quote) quote = ''
    } else if (c == '"' || c == "'") quote = c
    else if (c == '[') depth++
    else if (c == ']') {
      if (!depth) throw new SyntaxError('an unmatched collection bracket')
      depth--
    } else if (c == ';' && !depth) {
      parts.push(source.slice(start, i).trim())
      start = i + 1
    }
  }
  if (quote) throw new SyntaxError('an unclosed quote in a match')
  if (depth) throw new SyntaxError('an unclosed collection bracket')
  parts.push(source.slice(start).trim())
  return parts.filter(Boolean)
}

export let parseMatch = (
  source: string,
  opts: ParseOpts = { text: false },
): MatchPart[] =>
  split(source).map((part): MatchPart => {
    if (!part.startsWith('[')) {
      return { kind: 'pattern', query: parse(part, opts) }
    }
    if (!part.endsWith(']')) {
      throw new SyntaxError(`a collection is one match part: ${part}`)
    }
    let parts = parseMatch(part.slice(1, -1), opts)
    if (!parts.length) throw new SyntaxError('an empty collection')
    return { kind: 'collection', parts }
  })
