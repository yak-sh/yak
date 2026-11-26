/**
 * What a space's Dashboard (./dashboard-view.ts, T-3702) is drawn from, as
 * the tab's page graph holds it (D-475):
 *
 * - the space's apps, its `spaceApp` rows (./space-apps.ts), each with its
 *   opens and whether it came from the gallery;
 * - `agentWork{space, app, version, at, by, name, operator}`: each release of
 *   its apps an agent put out, newest first: its Operator, or an agent
 *   writing for a person (Claude Code through the connector, yak in a
 *   terminal), never a person's own. The directory answers it as a read of
 *   the person, read again as the space's apps are released;
 * - `operatorFix{space, request, app, at, said, failed, working, asked}`:
 *   each break its Operator took up on its own (yaks.app's unseen.ts `fix`)
 *   with what it said of it, and what it is working on now. The space's
 *   Operator store answers it as a live read of the person;
 * - `suggestion{space, rank, name, says, ask, app}`: what the space
 *   could use and doesn't yet, picked from {@link FEATURES} by its facts
 *   (`Uses`), each said about one of its apps. The directory answers it;
 *   `dismissSuggestion{space, name}` dismisses one for good;
 * - its Updates, their `updateCard` and `updateOffer` rows (./update-rows.ts).
 *
 * A row's eid is derived from the person and what it shows, so two people's
 * rows never meet.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { PropSchema, VocabDoc } from '@yaks/vocab'

let WORK = '.agentWork.space='
let FIXES = '.operatorFix.space='
let SUGGESTIONS = '.suggestion.space='

/** The releases agents put out in the space `eid`. */
export let agentWork = (eid: string): string => WORK + eid

/** The space an `agentWork` line asks about, or undefined for another line. */
export let workSpace = (line: string): string | undefined =>
  line.startsWith(WORK) ? line.slice(WORK.length) : undefined

/** The breaks the Operator of the space `eid` took up, and what it works on. */
export let operatorFixes = (eid: string): string => FIXES + eid

/** The space an `operatorFixes` line asks about, or undefined for another
 * line. */
export let fixesSpace = (line: string): string | undefined =>
  line.startsWith(FIXES) ? line.slice(FIXES.length) : undefined

/** What the Dashboard of the space `eid` suggests. */
export let suggestions = (eid: string): string => SUGGESTIONS + eid

/** The space a `suggestions` line asks about, or undefined for another line. */
export let suggestedSpace = (line: string): string | undefined =>
  line.startsWith(SUGGESTIONS) ? line.slice(SUGGESTIONS.length) : undefined

let str = { type: 'string' }
let int = { type: 'integer' }
let bool = { type: 'boolean' }
let row = (properties: Record<string, PropSchema>, required: string[]) => ({
  component: true,
  type: 'object',
  properties,
  required,
})

export let dashboardWords: VocabDoc = {
  $defs: {
    agentWork: row(
      {
        space: str,
        app: str,
        version: int,
        at: str,
        by: str,
        name: str,
        operator: bool,
      },
      ['space', 'app', 'at', 'by', 'name'],
    ),
    operatorFix: row(
      {
        space: str,
        request: str,
        app: str,
        at: str,
        said: str,
        failed: bool,
        working: bool,
        asked: str,
      },
      ['space', 'request', 'at'],
    ),
    suggestion: row(
      {
        space: str,
        rank: int,
        name: str,
        says: str,
        ask: str,
        app: str,
      },
      ['space', 'rank', 'name', 'says', 'ask'],
    ),
    dismissSuggestion: row({ space: str, name: str }, ['space', 'name']),
  },
}

// A property the row has no word on is left out, as the graph keeps it.
let drop = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== ''),
  ) as T

let held = <T>(rows: Bundle[], comp: string, space: string): T[] =>
  rows.flatMap((r) => {
    let c = r[comp] as (T & { space?: string }) | undefined
    return c?.space == space ? [c] : []
  })

/** A release an agent put out: of which app and its version, when, by whom
 * (`by`, the actor's eid) and what they are called, and whether that was the
 * space's Operator. */
export type Release = {
  app: string
  version?: number
  at: string
  by: string
  name: string
  operator?: boolean
}

/** `releases` in the space `space`, as `person`'s rows. */
export let workRows = (
  person: string,
  space: string,
  releases: Release[],
): Bundle[] =>
  releases.map((r) => ({
    entity: {
      eid: derivedEid(`agent-work|${person}|${r.app}|${r.version}|${r.at}`),
    },
    agentWork: drop({ space, ...r }),
  }))

/** The releases of the space `space` that `rows` hold, newest first. */
export let releasesOf = (rows: Bundle[], space: string): Release[] =>
  held<Release>(rows, 'agentWork', space)
    .map(({ space: _, ...r }: Release & { space?: string }) => r)
    .sort((a, b) => b.at.localeCompare(a.at))

/** A request the Operator took: a break in `app` it took up on its own,
 * when, what it said of it, and whether it could not finish; or `working`,
 * one it is on now, with the words it was `asked` where they are the
 * person's own. */
export type Fix = {
  request: string
  app?: string
  at: string
  said?: string
  failed?: boolean
  working?: boolean
  asked?: string
}

/** `fixes` in the space `space`, as `person`'s rows. */
export let fixRows = (person: string, space: string, fixes: Fix[]): Bundle[] =>
  fixes.map((f) => ({
    entity: { eid: derivedEid(`operator-fix|${person}|${f.request}`) },
    operatorFix: drop({ space, ...f }),
  }))

/** The fixes of the space `space` that `rows` hold, newest first. */
export let fixesOf = (rows: Bundle[], space: string): Fix[] =>
  held<Fix>(rows, 'operatorFix', space)
    .map(({ space: _, ...f }: Fix & { space?: string }) => f)
    .sort((a, b) => b.at.localeCompare(a.at))

/** The first sentence of `text`, the Markdown an agent wrote, at most
 * about `most` characters: what a line of Recent work says of it.
 *
 * ```ts
 * import { summary } from '@yaks/platform/dashboard'
 * import { assertEquals } from '@std/assert'
 * assertEquals(summary('Fixed the save. It waits now.\n\nMore.'), 'Fixed the save.')
 * assertEquals(summary('## Done\nThe map loads.'), 'Done')
 * assertEquals(summary('a '.repeat(100), 9), 'a a a a…')
 * ```
 */
export let summary = (text: string, most = 140): string => {
  let first = text.trim().split(/\n\s*\n|\n/)[0]?.replace(/^[#>*\-\s]+/, '') ??
    ''
  let sentence = first.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? first
  return sentence.length <= most
    ? sentence
    : sentence.slice(0, sentence.lastIndexOf(' ', most - 1)).trimEnd() + '…'
}

/** One line of Recent work: who did what (`does`) to which app, when, what
 * it said of it, whether it could not finish, and how many times running it
 * did the same. */
export type Did = {
  who: string
  does: string
  app?: string
  at: string
  said?: string
  failed?: boolean
  times: number
}

// What a fix is said as, by how it went.
let fixed = (f: Fix) =>
  f.failed ? 'couldn’t fix a break in' : 'fixed a break in'

/**
 * Recent work in a space, newest first, at most `count` lines: each fix its
 * Operator (`operator`) made on its own, and each release an agent put out,
 * a release the Operator made while fixing a break left to the fix it was
 * part of, and the same thing done again in a row counted once (`times`).
 * The app's titles come from `titles`, by eid.
 *
 * ```ts
 * import { worked } from '@yaks/platform/dashboard'
 * import { assertEquals } from '@std/assert'
 * let titles = new Map([['r', 'Roster']])
 * assertEquals(
 *   worked('Hazel', [
 *     { app: 'r', version: 4, at: '2026-11-20T10:00:00Z', by: 's', name: 'Hazel', operator: true },
 *     { app: 'r', version: 3, at: '2026-11-19T10:00:00Z', by: 'a', name: 'Claude Code' },
 *     { app: 'r', version: 2, at: '2026-11-18T10:00:00Z', by: 'a', name: 'Claude Code' },
 *   ], [
 *     { request: 'q', app: 'r', at: '2026-11-20T09:59:00Z', said: 'Saves wait now.' },
 *   ], titles).map((d) => [d.who, d.does, d.app, d.times]),
 *   [['Hazel', 'fixed a break in', 'Roster', 1], ['Claude Code', 'updated', 'Roster', 2]],
 * )
 * ```
 */
export let worked = (
  operator: string,
  releases: Release[],
  fixes: Fix[],
  titles: ReadonlyMap<string, string>,
  count = 6,
): Did[] => {
  let done = fixes.filter((f) => !f.working)
  // The release a fix put out falls in the hour after the break was taken.
  let during = (r: Release) =>
    r.operator && done.some((f) =>
      f.app == r.app && r.at >= f.at &&
      Date.parse(r.at) - Date.parse(f.at) < 60 * 60_000
    )
  let lines: Did[] = [
    ...done.map((f) => ({
      who: operator,
      does: fixed(f),
      app: f.app && titles.get(f.app),
      at: f.at,
      said: f.said,
      failed: f.failed,
      times: 1,
    })),
    ...releases.filter((r) => !during(r)).map((r) => ({
      who: r.operator ? operator : r.name,
      does: r.version == 1 ? 'made' : 'updated',
      app: titles.get(r.app),
      at: r.at,
      times: 1,
    })),
  ].filter((d) => d.app).sort((a, b) => b.at.localeCompare(a.at))
  let grouped: Did[] = []
  for (let d of lines) {
    let last = grouped.at(-1)
    if (last && last.who == d.who && last.does == d.does && last.app == d.app) {
      last.times++
      last.said ??= d.said
    } else grouped.push({ ...d })
  }
  return grouped.slice(0, count)
}

/** What the Operator is on now, where it is on something: the newest
 * request it holds unanswered. */
export let workingOf = (fixes: Fix[]): Fix | undefined =>
  fixes.find((f) => f.working)

/** What a space already uses, as its rows say. */
export type Uses = {
  /** a hostname of its own on one of its apps */
  domain: boolean
  /** a member beside its owner */
  people: boolean
  /** a seller account, taking payments */
  selling: boolean
  /** an app with a phone number of its own */
  texts: boolean
  /** the person reaches its Operator by text */
  phoned: boolean
}

/** An app as a suggestion is said about it: its slug, its title, and its
 * opens, which put it first. */
export type Fitted = { eid: string; slug: string; title: string }

/** A feature of the platform as a row: `name` keys its dismissal; `uses`,
 * the fact that makes it moot; `app`, whether it is said about one of the
 * space's apps; `says`, its short line, and `ask`, the longer request a
 * press on it writes in the box to the Operator, where `{app}` is the app's
 * title, `{domain}` a domain made of it and `{operator}` the Operator's
 * name. */
export type Feature = {
  name: string
  uses?: keyof Uses
  app: boolean
  says: string
  ask: string
}

/** The features a Dashboard suggests from, in the order it offers them. */
export let FEATURES: Feature[] = [
  {
    name: 'domain',
    uses: 'domain',
    app: true,
    says: 'Put {app} on {domain}',
    ask:
      'I’d like {app} at its own address, {domain}. Check whether the domain is free, tell me what it costs a year, and set it up once I say yes.',
  },
  {
    name: 'people',
    uses: 'people',
    app: true,
    says: 'Invite family to sign in to {app}',
    ask:
      'I’d like my family to sign in to {app}. Tell me how to invite them, and what they will be able to see and change.',
  },
  {
    name: 'operator-texts',
    uses: 'phoned',
    app: false,
    says: 'Text {operator} from your phone',
    ask: 'How do I text you from my phone, {operator}?',
  },
  {
    name: 'install',
    app: true,
    says: 'Add {app} to your home screen',
    ask: 'How do I add {app} to my phone’s home screen?',
  },
  {
    name: 'selling',
    uses: 'selling',
    app: true,
    says: 'Take payments or donations in {app}',
    ask: 'Help me take payments or donations in {app}. What would it take?',
  },
  {
    name: 'texts',
    uses: 'texts',
    app: true,
    says: 'Give {app} a phone number for texts',
    ask:
      'Could {app} have a phone number of its own, to send and receive texts? Tell me what it would do.',
  },
]

/** A suggestion as the Dashboard shows it: what it says, about which app,
 * and the longer request it writes in the box to the Operator. */
export type Suggestion = {
  name: string
  says: string
  app?: string
  ask: string
}

let domainOf = (title: string) =>
  (title.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'yourname') + '.com'

let filled = (text: string, operator: string, app?: Fitted) =>
  text.replaceAll('{operator}', operator)
    .replaceAll('{app}', app ? app.title || app.slug : '')
    .replaceAll('{domain}', app ? domainOf(app.title || app.slug) : '')

/**
 * Up to `count` suggestions for a space whose Operator is `operator`: each
 * feature its facts (`uses`) don't make moot and the person hasn't dismissed
 * (`dismissed`, by name), each said about another of its `apps`, most opened
 * first, where it is about one.
 *
 * ```ts
 * import { suggested } from '@yaks/platform/dashboard'
 * import { assertEquals } from '@std/assert'
 * let uses = { domain: true, people: false, selling: true, texts: true, phoned: false }
 * let apps = [{ eid: 'a', slug: 'roster', title: 'Roster' }, { eid: 'b', slug: 'town', title: 'Township' }]
 * assertEquals(
 *   suggested({ operator: 'Hazel', uses, apps, dismissed: ['install'] }).map((s) => s.says),
 *   ['Invite family to sign in to Roster', 'Text Hazel from your phone'],
 * )
 * ```
 */
export let suggested = (
  at: { operator: string; uses: Uses; apps: Fitted[]; dismissed: string[] },
  count = 4,
  features: Feature[] = FEATURES,
): Suggestion[] => {
  let said = new Set<string>()
  let about = () => at.apps.find((a) => !said.has(a.eid)) ?? at.apps[0]
  return features
    .filter((f) => !(f.uses && at.uses[f.uses]))
    .filter((f) => !at.dismissed.includes(f.name))
    .flatMap((f) => {
      let app = f.app ? about() : undefined
      if (f.app && !app) return []
      if (app) said.add(app.eid)
      return [drop({
        name: f.name,
        says: filled(f.says, at.operator, app),
        app: app?.slug,
        ask: filled(f.ask, at.operator, app),
      })]
    })
    .slice(0, count)
}

/** `offered` in the space `space`, as `person`'s rows, in order. */
export let suggestionRows = (
  person: string,
  space: string,
  offered: Suggestion[],
): Bundle[] =>
  offered.map((s, rank) => ({
    entity: { eid: derivedEid(`suggestion|${person}|${space}|${s.name}`) },
    suggestion: drop({ space, rank, ...s }),
  }))

/** The suggestions in the space `space` that `rows` hold, in order, but
 * those a `dismissSuggestion` row there names. */
export let suggestionsOf = (rows: Bundle[], space: string): Suggestion[] => {
  let gone = new Set(
    held<{ name: string }>(rows, 'dismissSuggestion', space).map((d) => d.name),
  )
  return held<Suggestion & { rank: number }>(rows, 'suggestion', space)
    .filter((s) => !gone.has(s.name))
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _r, space: _s, ...s }: Suggestion & {
      rank: number
      space?: string
    }) => s)
}

/** The act that dismisses the suggestion `name` in the space `space` for
 * the person, for good. */
export let dismissal = (space: string, name: string): Bundle => ({
  entity: { eid: derivedEid(`dismiss-suggestion|${space}|${name}`) },
  dismissSuggestion: { space, name },
})

/** The dismissal `bundles` hold alone, where they are one. */
export let dismissing = (
  bundles: Bundle[],
): { space: string; name: string } | undefined =>
  bundles.length == 1
    ? bundles[0].dismissSuggestion as { space: string; name: string }
    : undefined
