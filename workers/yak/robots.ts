// What a site says about being copied, read as RFC 9309 reads robots.txt and
// as search engines read `noarchive`: the library tools (library-tools.ts)
// skip what a site forbids rather than working around it.

/**
 * Whether robots.txt lets `agent` fetch `path`: the group naming the agent,
 * else the `*` group; within it the longest matching rule wins, and `Allow`
 * wins a tie. `*` in a rule matches anything and `$` ends it.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { allowed } from './robots.ts'
 * let txt = 'User-agent: *\nDisallow: /private\nAllow: /private/open$\n\n' +
 *   'User-agent: yaks.app\nDisallow: /'
 * assert(allowed(txt, 'other', '/public'))
 * assert(!allowed(txt, 'other', '/private/x'))
 * assert(allowed(txt, 'other', '/private/open'))
 * assert(!allowed(txt, 'yaks.app', '/public'))
 * assert(allowed('', 'yaks.app', '/'))
 * assert(!allowed('User-agent: *\nDisallow: /*.pdf$', 'x', '/a/b.pdf'))
 * ```
 */
export let allowed = (robots: string, agent: string, path: string) => {
  let groups: { agents: string[]; rules: [boolean, string][] }[] = []
  let open = false
  for (let raw of robots.split(/\r?\n/)) {
    let line = raw.replace(/#.*/, '').trim()
    let at = line.indexOf(':')
    if (at < 0) continue
    let key = line.slice(0, at).trim().toLowerCase()
    let value = line.slice(at + 1).trim()
    if (key == 'user-agent') {
      if (!open) groups.push({ agents: [], rules: [] })
      groups.at(-1)!.agents.push(value.toLowerCase())
      open = true
    } else if ((key == 'allow' || key == 'disallow') && groups.length) {
      open = false
      if (value) groups.at(-1)!.rules.push([key == 'allow', value])
    }
  }
  let me = agent.toLowerCase()
  let mine = groups.filter((g) =>
    g.agents.some((a) => a != '*' && me.includes(a))
  )
  if (!mine.length) mine = groups.filter((g) => g.agents.includes('*'))
  let best: [boolean, string] | undefined
  for (let rule of mine.flatMap((g) => g.rules)) {
    if (!matches(rule[1], path)) continue
    if (
      !best || rule[1].length > best[1].length ||
      (rule[1].length == best[1].length && rule[0])
    ) best = rule
  }
  return best?.[0] ?? true
}

let matches = (rule: string, path: string) => {
  let anchored = rule.endsWith('$')
  let pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + pattern + (anchored ? '$' : '')).test(path)
}

/**
 * Whether an `X-Robots-Tag` header or a `<meta name="robots">` asks that the
 * page not be kept: `noarchive`, `noai` or `none`.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { uncopyable } from './robots.ts'
 * assert(uncopyable('noindex, noarchive'))
 * assert(uncopyable('googlebot: none'))
 * assert(!uncopyable('noindex, nofollow'))
 * assert(!uncopyable(null))
 * ```
 */
export let uncopyable = (said: string | null | undefined) =>
  !!said && /(^|[\s,:])(noarchive|noai|none)\b/i.test(said)
