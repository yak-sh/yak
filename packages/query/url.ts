// A query is the URL's search itself. Page state has @-prefixed keys, outside
// the query's property grammar. Quotes keep literal ampersands inside values;
// percent, hash and whitespace are escaped once at the URL boundary.

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
  let quote = '', escaped = false
  let query = Array.from(line.trim(), (c) => {
    let literal = !!quote
    if (escaped) escaped = false
    else if (quote && c == '\\') escaped = true
    else if (c == quote) quote = ''
    else if (!quote && (c == '"' || c == "'")) quote = c
    return c == '&' && literal ? '%26' : encode(c)
  }).join('')
  let params = Object.entries(state).map(([k, v]) =>
    `@${encodeURIComponent(k)}=${encodeURIComponent(v)}`
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
    return { query, state: params, legacy: true }
  }
  let clauses: string[] = [], state = new URLSearchParams()
  for (let part of search.replace(/^\?/, '').split('&')) {
    let match = part.match(/^@([^=]+)=(.*)$/s)
    if (match) state.append(decode(match[1]), decode(match[2]))
    else if (part) clauses.push(part)
  }
  return {
    query: clauses.length ? decode(clauses.join('&')) : null,
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
