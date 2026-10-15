// What a letter about a bug says. It is read alone, in an inbox, by someone
// deciding whether to drop everything: so it carries what the tracker holds
// that tells urgency — where it ran, whom it reached, how often and how
// lately, the request, the code and the moments before it — read from the bug
// and its retained occurrences. Nothing here is stored or fetched.

import type { Bundle } from '@yaks/graph'
import { comp, type Crumb, type Frame, str } from './model.ts'
import { count, headline, sha, whom } from './brief.ts'
import { frameAt, said, where } from './reading.ts'
import { explained } from './resolution.ts'
import { fixtime, span } from './fixtime.ts'
import { tags, tally } from './spread.ts'

/** What a letter is addressed by: the bug's name, its page and the moment it
 * is written. */
export type Address = { name: string; url: string; now: string }

let tag = (b: Bundle, key: string): string =>
  tags(b).find(([k]) => k == key)?.[1] ?? ''
let during = (b: Bundle, key: string): string => str(comp(b, 'during')[key])
let short = (eid: string): string =>
  /^[0-9a-f]{8}-/i.test(eid) ? `${eid.slice(0, 8)}…` : eid

/// when('2026-10-12T14:27:57.663Z') -> '2026-10-12 14:27:57 UTC'
/// when('') -> ''
/** A moment as UTC to the second: a letter is read later, anywhere. */
export let when = (at: string): string => {
  let t = Date.parse(at)
  return Number.isFinite(t)
    ? new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    : ''
}

// The most shared value `pick` reads, with how many more there are.
let top = (errors: Bundle[], pick: (b: Bundle) => string): string => {
  let [first, ...rest] = tally(errors, pick)
  return first
    ? first.value + (rest.length ? ` (+${rest.length} more)` : '')
    : ''
}

/// let box = { entity: { eid: 'e' }, error: { tags: { source: 'box' } } }
/// origin([box]) -> 'box'
/// origin([{ entity: { eid: 'f' }, error: {} }]) -> 'yaks.app'
/** Where the occurrences were caught: the box's own processes, or yaks.app. */
export let origin = (errors: Bundle[]): string =>
  top(errors, (b) => tag(b, 'source') == 'box' ? 'box' : 'yaks.app')
    .replace(/ \(.*$/, '') || 'yaks.app'

// Reporters tag the space and app by slug; an occurrence without them names
// only the eids its context holds.
let space = (b: Bundle): string => tag(b, 'space') || short(during(b, 'space'))
let app = (b: Bundle): string => tag(b, 'app') || short(during(b, 'app'))

/// let tagged = (tags: object) => ({ entity: { eid: crypto.randomUUID() }, error: { tags } })
/// scope([tagged({ space: 'yourname', app: 'vale' }), tagged({ space: 'yourname', app: 'vale' })]) -> 'yourname/vale'
/// scope([tagged({ space: 'ann' }), tagged({ space: 'bo' })]) -> 'ann (+1 more)'
/// scope([tagged({ source: 'box' })]) -> ''
/** The space and app most occurrences ran in. */
export let scope = (errors: Bundle[]): string =>
  top(errors, (b) => [space(b), app(b)].filter(Boolean).join('/'))

/// ran([tagged({ source: 'box', command: 'yak work', roles: 'graph,effects', handler: 'mail_send' })]) -> 'box · yak work (graph,effects) · mail_send'
/// ran([tagged({ space: 'yourname', app: 'vale', script: 'yourname_vale', version: '42', entrypoint: 'browser report' })]) -> 'yaks.app · yourname/vale · v42 · browser report'
/// ran([tagged({ script: 'yak', entrypoint: 'fetch', tool: 'app_deploy' })]) -> 'yaks.app · worker yak · fetch · app_deploy'
/** Where it ran, as one line: the host, the space and app, the process or
 * worker, and the operation that failed. An app's own script and version
 * read as its version; a platform worker's as the worker. */
export let ran = (errors: Bundle[]): string => {
  let worker = (b: Bundle) =>
    tag(b, 'script') && !tag(b, 'app') ? `worker ${tag(b, 'script')}` : ''
  let process = (b: Bundle) =>
    [tag(b, 'command'), tag(b, 'roles') && `(${tag(b, 'roles')})`]
      .filter(Boolean).join(' ') ||
    worker(b) ||
    (during(b, 'process') && `process ${short(during(b, 'process'))}`)
  let version = (b: Bundle) =>
    tag(b, 'app') && tag(b, 'version') ? `v${tag(b, 'version')}` : ''
  let operation = (b: Bundle) =>
    tag(b, 'entrypoint') || tag(b, 'tool') || tag(b, 'handler') ||
    tag(b, 'role') || tag(b, 'step')
  let at = (b: Bundle) =>
    tag(b, 'entrypoint') && (tag(b, 'tool') || tag(b, 'handler'))
  return [
    origin(errors),
    scope(errors),
    top(errors, process),
    top(errors, version),
    top(errors, operation),
    top(errors, at),
  ].filter(Boolean).join(' · ')
}

/// tested([tagged({ account: 'test' }), tagged({ source: 'box' })]) -> true
/// tested([tagged({ account: 'test' }), tagged({ account: 'person' })]) -> false
/// tested([tagged({ source: 'box' })]) -> false
/** Whether it reached test accounts only: a probe's or an agent's throwaway
 * broke, not a person's work. */
export let tested = (errors: Bundle[]): boolean => {
  let kinds = tally(errors, (b) => tag(b, 'account')).map((t) => t.value)
  return kinds.length == 1 && kinds[0] == 'test'
}

/// reached([tagged({ user_id: 'a', account: 'person', space: 's' }), tagged({ user_id: 'b', account: 'test', space: 's' })]) -> '2 people, 1 of them a test account · 1 space'
/// reached([tagged({ account: 'test', space: 't122930', app: 'drills' })]) -> 'test accounts only · 1 space · 1 app'
/// reached([tagged({ account: 'person', space: 'jill', app: 'flavors' })]) -> "a person's space, no signed-in person recorded · 1 space · 1 app"
/// reached([tagged({ source: 'box' })]) -> 'no person recorded'
/** Whom it reached: the people its occurrences name, whether only test
 * accounts, and how many spaces and apps. */
export let reached = (errors: Bundle[]): string => {
  let people = tally(errors, (b) => tag(b, 'user_id'))
  let tests = tally(
    errors,
    (b) => tag(b, 'account') == 'test' ? tag(b, 'user_id') : '',
  )
  let account = tested(errors)
    ? 'test'
    : errors.some((b) => tag(b, 'account') == 'person')
    ? 'person'
    : null
  let spaces = tally(errors, space).length
  let apps = tally(errors, app).length
  return [
    whom(people.length, account) +
    (account != 'test' && tests.length
      ? `, ${tests.length} of them a test account`
      : ''),
    spaces ? count(spaces, 'space') : '',
    apps ? count(apps, 'app') : '',
  ].filter(Boolean).join(' · ')
}

let hits = (b: Bundle) => Number(comp(b, 'error').hits ?? 1)

/// let seen = (at: string) => ({ entity: { eid: at }, error: { at } })
/// often({ entity: { eid: 'b' }, bug: { hits: 45, first: '2026-10-12T14:27:57Z', last: '2026-10-12T15:12:18Z' } }, [seen('2026-10-12T15:12:18Z'), seen('2026-10-12T14:00:00Z')], '2026-10-12T15:13:00Z') -> '45 hits, 1 in the last hour · first 2026-10-12 14:27:57 UTC · last 2026-10-12 15:12:18 UTC'
/** How often, and how lately: every hit, the last hour's, first and last. */
export let often = (bug: Bundle, errors: Bundle[], now: string): string => {
  let b = comp(bug, 'bug'), hour = Date.parse(now) - 3_600_000
  let recent = errors.filter((e) =>
    Date.parse(str(comp(e, 'error').at)) >= hour
  )
    .reduce((n, e) => n + hits(e), 0)
  return [
    `${count(Number(b.hits ?? 1), 'hit')}, ${recent} in the last hour`,
    `first ${when(str(b.first))}`,
    `last ${when(str(b.last))}`,
  ].join(' · ')
}

/// asked({ entity: { eid: 'r' }, request: { method: 'POST', url: 'https://a.yaks.app/vale/api/query', status: 500, ms: 12, agent: 'Chrome 153 on macOS' } }) -> 'POST https://a.yaks.app/vale/api/query → 500 in 12 ms · Chrome 153 on macOS'
/// asked(undefined) -> ''
/** The request that failed, as its method, address, answer and client. */
export let asked = (row: Bundle | undefined): string => {
  let r = comp(row, 'request')
  if (!r.url && !r.route) return ''
  return [
    [
      str(r.method),
      str(r.url || r.route),
      r.status != null ? `→ ${r.status}` : '',
      r.ms != null ? `in ${r.ms} ms` : '',
    ].filter(Boolean).join(' '),
    str(r.agent),
  ].filter(Boolean).join(' · ')
}

/// let made = (commit: string, at: string) => ({ entity: { eid: at }, error: { commit, at, environment: 'production' } })
/// built([made('2e13aff3a1b2c3d4e5f60718293a4b5c6d7e8f90', '2'), made('0dc50144a1b2c3d4e5f60718293a4b5c6d7e8f90', '1')]) -> '2e13aff (newest), first seen in 0dc5014 · production'
/// built([made('2e13aff3a1b2c3d4e5f60718293a4b5c6d7e8f90', '1')]) -> '2e13aff · production'
/** The commit it last ran, the one it was first seen in, and where. */
export let built = (errors: Bundle[]): string => {
  let commits = tally(errors, (b) => str(comp(b, 'error').commit))
  let newest = commits.toSorted((a, b) => b.last.localeCompare(a.last))[0]
  let oldest = commits.toSorted((a, b) => a.first.localeCompare(b.first))[0]
  return [
    newest
      ? sha(newest.value) +
        (oldest.value != newest.value
          ? ` (newest), first seen in ${sha(oldest.value)}`
          : '')
      : '',
    top(errors, (b) => str(comp(b, 'error').environment)),
  ].filter(Boolean).join(' · ')
}

// What the letter has said already in its own lines; the rest of the tags
// are context.
let SAID = new Set([
  'source',
  'command',
  'roles',
  'script',
  'space',
  'app',
  'version',
  'entrypoint',
  'user_id',
  'account',
  'tool',
  'handler',
  'role',
  'step',
])

/** Every other tag the occurrences carry, each with its most shared value. */
export let context = (errors: Bundle[]): string[] =>
  [...new Set(errors.flatMap((b) => tags(b).map(([k]) => k)))]
    .filter((k) => !SAID.has(k))
    .map((k) => `${k}: ${top(errors, (b) => tag(b, k))}`)

/** The newest occurrence's top frames, its own code in bold. */
export let stack = (newest: Bundle | undefined, n = 6): string[] =>
  ((comp(newest, 'exception').frames ?? []) as Frame[]).slice(0, n)
    .map((f) => f.app ? `**${frameAt(f)}**` : frameAt(f))

/** The last few moments before the newest occurrence. */
export let before = (newest: Bundle | undefined, n = 5): string[] =>
  ((comp(newest, 'breadcrumbs').items ?? []) as Crumb[]).slice(-n)
    .map((c) => `${when(c.at).slice(11)} ${c.category}: ${headline(c.message)}`)

let list = (heading: string, lines: string[]) =>
  lines.length ? [`**${heading}**`, '', ...lines.map((l) => `- ${l}`), ''] : []

/** The subject: where it ran, the bug's name and its headline. */
export let subject = (bug: Bundle, errors: Bundle[], name: string): string =>
  `[${
    [
      origin(errors),
      scope(errors).replace(/ \(.*$/, ''),
      tested(errors) ? 'test account' : '',
    ].filter(Boolean).join(' ')
  }] ${name}: ${headline(said(bug))}`

/** The whole letter for a bug's opening or regression. `errors` are its
 * retained occurrences, newest first; `request` is the newest one's. */
export let letter = (
  bug: Bundle,
  errors: Bundle[],
  request: Bundle | undefined,
  to: Address,
): { title: string; body: string } => {
  let newest = errors[0]
  let back = comp(bug, 'regressed')
  let call = asked(request), commit = built(errors)
  let facts = [
    back.at
      ? `**Regressed:** ${when(str(back.at))}, after it was resolved`
      : '',
    `**Ran on:** ${ran(errors) || 'not recorded'}`,
    `**Reached:** ${reached(errors)}`,
    `**How often:** ${often(bug, errors, to.now)}`,
    call ? `**Request:** ${call}` : '',
    `**Code:** ${where(bug, newest) || 'not recorded'}`,
    commit ? `**Commit:** ${commit}` : '',
  ].filter(Boolean)
  return {
    title: subject(bug, errors, to.name),
    body: [
      said(bug).trim(),
      '',
      ...facts.map((f) => `- ${f}`),
      '',
      ...list('Stack', stack(newest)),
      ...list('Before it', before(newest)),
      ...list('Context', context(errors)),
      `[View ${to.name}](${to.url})`,
    ].join('\n'),
  }
}

// What a mark says in the bug's thread.
let word = (bug: Bundle, mark: Mark, at: string): string => {
  let task = str(comp(bug, 'taken').task), open = fixtime(bug)
  return mark == 'taken'
    ? `A fixer started on it ${at}${
      task ? `, working ${task}` : ''
    }. You hear here when it is resolved.`
    : mark == 'resolved'
    ? `Resolved ${at}${
      open == undefined ? '' : `, ${span(open)} after it opened`
    }.`
    : `Archived ${at}. It stays quiet even if it happens again.`
}

export type Mark = 'taken' | 'resolved' | 'archived'

/// commit('https://github.com/yak-sh/yak/')('9917d09d30a68730b83661652bdcaecc38670809') -> '[9917d09](https://github.com/yak-sh/yak/commit/9917d09d30a68730b83661652bdcaecc38670809)'
/// commit()('9917d09d30a68730b83661652bdcaecc38670809') -> '9917d09'
/** A commit as a letter names it: its short sha, linked into the repository's
 * web pages when there is one. */
export let commit = (repo?: string) => (full: string): string =>
  repo
    ? `[${sha(full)}](${repo.replace(/\/+$/, '')}/commit/${full})`
    : sha(full)

/** What a resolution says: its explanation, and whom the bug reached beside
 * what broke. */
export let resolution = (
  bug: Bundle,
  errors: Bundle[],
  repo?: string,
): string[] => {
  let lines = explained(bug, commit(repo))
  if (lines.length && errors.length) {
    lines.splice(1, 0, ['Whom it reached', reached(errors)])
  }
  return lines.map(([label, line]) => `- **${label}:** ${line}`)
}

/** A later word in the bug's thread: a fixer took it, or it was resolved or
 * archived. A resolution says why, from its explanation; `errors` are the
 * bug's retained occurrences, which say whom it reached, and `repo` is the
 * web root its commits link into. */
export let followUp = (
  bug: Bundle,
  mark: Mark,
  thread: string,
  to: Address,
  { errors = [], repo }: { errors?: Bundle[]; repo?: string } = {},
): { title: string; body: string } => {
  let b = comp(bug, 'bug'), at = when(str(comp(bug, mark).at))
  let why = mark == 'resolved' ? resolution(bug, errors, repo) : []
  return {
    title: thread.startsWith('Re: ') ? thread : `Re: ${thread}`,
    body: [
      word(bug, mark, at),
      '',
      ...why.length ? [...why, ''] : [],
      `${count(Number(b.hits ?? 1), 'hit')} in all, the last ${
        when(str(b.last))
      }.`,
      '',
      `[View ${to.name}](${to.url})`,
    ].join('\n'),
  }
}
