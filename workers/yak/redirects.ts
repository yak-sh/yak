// An app's redirects, declared as data in a `_redirects` file beside its
// index.html, in Cloudflare's own format: one rule a line,
// `source destination [status]`, the first rule that matches wins, and `#`
// starts a comment. The status is 301, 302 (the default), 303, 307 or 308.
//
//   /calendar            /happening          301
//   /sermons/*           /sermons/:splat
//   /blog/:year/:slug    /posts/:slug
//
// A source is a path with `:name` for one segment and a final `*` for the
// rest; a trailing slash is no difference. A destination is a path of the app
// (`/happening`, whatever the app's mount) or an https address; its `:name`s
// and `:splat` are what the source caught. The visitor's query goes on to a
// destination that has none. A rule is on the path alone, as a kept page is
// (page-cache.ts): a query cannot choose between two answers. Lines that are
// not a rule are skipped.
export type Rule = {
  path: RegExp
  names: string[]
  to: string
  status: number
}

export type Sent = { to: string; status: number }

let STATUSES = [301, 302, 303, 307, 308]

let trimmed = (path: string) =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

let escaped = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

let compile = (path: string): Pick<Rule, 'path' | 'names'> => {
  let names: string[] = []
  let pattern = trimmed(path).split('/').map((segment) => {
    if (segment == '*') return names.push('splat'), '(.*)'
    if (/^:\w+$/.test(segment)) return names.push(segment.slice(1)), '([^/]+)'
    return escaped(segment)
  }).join('/')
  return { path: new RegExp(`^${pattern}$`), names }
}

/// parse('/old /new 301\n# no\n/a/* /b/:splat')[1].to -> '/b/:splat'
/// parse('/old /new 301')[0].status -> 301
/// parse('/old /new')[0].status -> 302
/// parse('/lonely').length -> 0
export let parse = (text: string): Rule[] =>
  text.split('\n').flatMap((line) => {
    let [from, to, status = '302'] = line.replace(/#.*/, '').trim().split(/\s+/)
    let code = Number(status)
    return from?.startsWith('/') && !from.includes('?') && to &&
        STATUSES.includes(code)
      ? [{ ...compile(from), to, status: code }]
      : []
  })

/// sentOn(parse('/old /new 301'), '/old/', '') -> { to: '/new', status: 301 }
/// sentOn(parse('/a/* /b/:splat'), '/a/x/y', '?q=1') -> { to: '/b/x/y?q=1', status: 302 }
/** Where a request for `path` with `search` (`?a=1`, or empty) goes, by the
 * first rule that matches, or null. */
export let sentOn = (
  rules: Rule[],
  path: string,
  search: string,
): Sent | null => {
  for (let rule of rules) {
    let found = rule.path.exec(trimmed(path))
    if (!found) continue
    let caught = Object.fromEntries(rule.names.map((n, i) => [n, found[i + 1]]))
    let to = rule.to.replace(/:(\w+)/g, (all, name) => caught[name] ?? all)
    return { to: to + (to.includes('?') ? '' : search), status: rule.status }
  }
  return null
}
