// A query line with every value hidden, for a trace to keep: what was asked
// (which properties, which operators, how it was ordered and limited) without
// what a person typed. It reads the line, never parses it, so a read that is
// traced pays one pass over the text and nothing else.

// A term: runs of non-separators with quoted spans kept whole, or a run of
// separators.
let TERM = /(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s&|()"'])+|[\s&|()]+/g
let OP = /!=|~=|<=|>=|=|<|>/
// Directives whose values say how to shape the answer, not what to match.
let SHAPE = new Set(['order', 'limit', 'fields', 'distinct', 'tally'])

/** The query with each value and bare word written `?`.
 *
 * ```ts
 * import { mask } from './mask.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   mask('.Completion .order=-created.at .title="a b"&milk .limit=5'),
 *   '.Completion .order=-created.at .title=?&? .limit=5',
 * )
 * ```
 */
export let mask = (q: string): string =>
  q.replace(TERM, (t) => {
    let c = t[0]
    if (/^[\s&|()]/.test(c)) return t
    if (c != '.' && c != '?' && c != '!' && c != '*') return '?'
    let at = t.search(OP)
    if (at < 0) return t
    let head = t.slice(0, at), op = t.slice(at).match(OP)![0]
    let name = head.replace(/^[.?!]/, '').split('.')[0]
    return SHAPE.has(name) ? t : head + op + '?'
  })
