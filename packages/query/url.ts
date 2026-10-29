// Query parameters start with grammar sigils; other parameters are page state.
// Quotes keep literal ampersands inside values;
// percent, hash and whitespace are escaped once at the URL boundary.

import { tokens } from './parse.ts'

let clause = (s: string) => /^[.!?+*#$(-]/.test(s.trimStart())
let page = (key: string) => !clause(key) && !key.startsWith('@')

let decode = (s: string) =>
  new URLSearchParams('value=' + s.replace(/[&+]/g, encodeURIComponent)).get(
    'value',
  )!
let encode = (s: string) =>
  encodeURI(s).replace(/#/g, '%23').replace(/%3[CE]/g, decode)

/** The search string for a query and optional page state. */
export let querySearch = (
  line: string,
  state: Record<string, string> = {},
): string => {
  line = line.trim()
  // Bare full-text terms have no sigil. A grammar group gives a text-only
  // query an opening marker without introducing a second text syntax.
  if (line && !clause(line)) line = `(${line})`
  let quote = '', escaped = false, depth = 0
  let query = Array.from(line.trim(), (c) => {
    let literal = !!quote
    if (escaped) escaped = false
    else if (quote && c == '\\') escaped = true
    else if (c == quote) quote = ''
    else if (!quote && (c == '"' || c == "'")) quote = c
    if (!literal && c == '(') depth++
    if (!literal && c == ')') depth--
    return c == '&' && (literal || depth) ? '%26' : encode(c)
  }).join('')
  // Keep any full-text terms after & inside the preceding query parameter.
  query = query.split('&').reduce(
    (out, part) =>
      out + (out ? (clause(decode(part)) ? '&' : '%26') : '') + part,
    '',
  )
  let params = Object.entries(state).filter(([k]) => page(k)).map(([k, v]) =>
    `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
  )
  return '?' + [query, ...params].filter(Boolean).join('&')
}

/** Query and page state carried by a search string, including kept ?q= links.
 * A plus is literal in the direct form; kept form submissions decode it as
 * URLSearchParams always did. */
export let queryAt = (search: string): {
  query: string | null
  state: URLSearchParams
  legacy: boolean
} => {
  let params = new URLSearchParams(search)
  if (params.has('q')) {
    let query = params.get('q')!
    params.delete('q')
    let state = new URLSearchParams([...params].filter(([k]) => page(k)))
    return { query, state, legacy: true }
  }
  let clauses: string[] = [], state = new URLSearchParams()
  for (let part of search.replace(/^\?/, '').split('&')) {
    if (!part) continue
    let decoded = decode(part)
    if (clause(decoded)) clauses.push(decoded)
    else {
      let [key, ...value] = part.split('=')
      if (page(decode(key))) state.append(decode(key), decode(value.join('=')))
    }
  }
  let query = clauses.join('&')
  // A single outer group is equivalent to its contents.
  if (
    query.startsWith('(') && query.endsWith(')') && tokens(query).length == 1
  ) {
    query = query.slice(1, -1)
  }
  return {
    query: query || null,
    state,
    legacy: false,
  }
}

/** A kept page address redirects without losing its page state or fragment. */
export let queryRedirect = (url: URL): string | undefined => {
  let { query, state, legacy } = queryAt(url.search)
  return legacy
    ? url.pathname + querySearch(query!, Object.fromEntries(state)) + url.hash
    : undefined
}
