// An app's redirects, declared as data in a `_redirects` file beside its
// index.html, in Cloudflare's own format: one rule a line,
// `source destination [status]`, the first rule that matches wins, and `#`
// starts a comment. The status is 301, 302 (the default), 303, 307 or 308.
//
//   /calendar            /happening          301
//   /sermons/*           /sermons/:splat
//   /blog/:year/:slug    /posts/:slug
//   /?flow=abc           /signup             301
//
// A source is a path with `:name` for one segment and a final `*` for the
// rest; a trailing slash is no difference. A `?key=value` on it asks the
// query to hold that pair, and a bare `?key` asks it to hold the key: the
// way a printed code or an old email link names its page. A destination is a
// path of the app (`/happening`, whatever the app's mount) or an https
// address; its `:name`s and `:splat` are what the source caught. A rule with
// no query on its source passes the visitor's query on; one that named a
// query consumed it. Lines that are not a rule are skipped.
export type Rule = {
  path: RegExp
  names: string[]
  query: [string, string | null][]
  to: string
  status: number
}

export type Sent = { to: string; status: number }

let STATUSES = [301, 302, 303, 307, 308]

/// trimmed('/a/b/') -> '/a/b'
/// trimmed('/') -> '/'
let trimmed = (path: string) =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

let escaped = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

let compile = (from: string): Pick<Rule, 'path' | 'names' | 'query'> => {
  let [path, search = ''] = from.split('?', 2)
  let names: string[] = []
  let pattern = trimmed(path).split('/').map((segment) => {
    if (segment == '*') return names.push('splat'), '(.*)'
    if (/^:\w+$/.test(segment)) return names.push(segment.slice(1)), '([^/]+)'
    return escaped(segment)
  }).join('/')
  let query = search.split('&').filter(Boolean).map((pair) => {
    let [key, ...value] = pair.split('=')
    return [key, value.length ? value.join('=') : null] as [
      string,
      string | null,
    ]
  })
  return { path: new RegExp(`^${pattern}$`), names, query }
}

/// parse('/old /new 301\n# no\n/a/* /b/:splat')[1].to -> '/b/:splat'
/// parse('/old /new 301')[0].status -> 301
/// parse('/old /new')[0].status -> 302
/// parse('/lonely').length -> 0
export let parse = (text: string): Rule[] =>
  text.split('\n').flatMap((line) => {
    let [from, to, status = '302'] = line.replace(/#.*/, '').trim().split(/\s+/)
    let code = Number(status)
    return from?.startsWith('/') && to && STATUSES.includes(code)
      ? [{ ...compile(from), to, status: code }]
      : []
  })

/// sentOn(parse('/old /new 301'), '/old/', '') -> { to: '/new', status: 301 }
/// sentOn(parse('/a/* /b/:splat'), '/a/x/y', '?q=1') -> { to: '/b/x/y?q=1', status: 302 }
/// sentOn(parse('/?id=7 /seven'), '/', '?id=7&x=1') -> { to: '/seven', status: 302 }
/// sentOn(parse('/?id=7 /seven'), '/', '?id=8') -> null
/// sentOn(parse('/?id /any'), '/', '?id=8') -> { to: '/any', status: 302 }
/** Where a request for `path` with `search` (`?a=1`, or empty) goes, by the
 * first rule that matches, or null. */
export let sentOn = (
  rules: Rule[],
  path: string,
  search: string,
): Sent | null => {
  let held = new URLSearchParams(search)
  for (let rule of rules) {
    let found = rule.path.exec(trimmed(path))
    if (
      !found ||
      !rule.query.every(([key, value]) =>
        held.has(key) && (value == null || held.get(key) == value)
      )
    ) continue
    let caught = Object.fromEntries(rule.names.map((n, i) => [n, found[i + 1]]))
    let to = rule.to.replace(/:(\w+)/g, (all, name) => caught[name] ?? all)
    let carry = !rule.query.length && !to.includes('?') ? search : ''
    return { to: to + carry, status: rule.status }
  }
  return null
}
