// A health check is a tool declared with the verb `check`. There is no
// registry of checks: the set of them is every tool with that verb in the
// loaded vocabulary. Load a plugin and its checks come with it; drop the
// plugin and they go too. So no list of checks can fall out of date, and no
// package owns another package's invariants.
//
// A check returns an ordinary tool answer — text on `content{body}`, with
// `output{source}` naming the call it came from — plus one extra component:
// `error{code}` when it found something, `fail` for a measured violation of a
// contract the package keeps, `warn` for a leak or for a verdict it could not
// establish. Reporting faults is not itself a failure (`faulted` in
// ./runner.ts reads the call's own `execution.state`), so a check that finds a
// broken graph still succeeded, and the caller reads the level instead of
// guessing from an exit code.
//
// Two rules carried over from the fleet doctor this replaces: a check that
// finds nothing still returns an answer (silence is indistinguishable from a
// check that never ran), and a check that cannot run reports `warn` rather
// than passing quietly.

import type { Bundle, Comp, Eid } from '@yaks/graph'

/** The verb that makes a tool a check. */
export let CHECK = 'check'

/** How bad a finding is. `fail` means a contract the package keeps was
 * measured to be broken; `warn` means a leak, or a verdict the check could not
 * establish. */
export type Level = 'fail' | 'warn'

/** One thing a check found. `text` is written for a person to read: what is
 * wrong, what it is about, and what it costs. */
export type Finding = { level: Level; text: string }

/** The checks among a list of tools — every one whose verb is `check`. It
 * filters the tool declarations the caller already has (`@yaks/graph/tools`
 * `loadTools` keeps `noun` and `verb` on each), so nothing has to be
 * registered or tracked separately. */
export let checks = <T extends { verb?: string }>(tools: T[]): T[] =>
  tools.filter((t) => t.verb == CHECK)

// The worst level among the findings, or nothing when there are none. A check
// with a single `fail` among its warnings is failing.
let worst = (found: Finding[]): Level | undefined =>
  found.some((f) => f.level == 'fail')
    ? 'fail'
    : found.length
    ? 'warn'
    : undefined

/**
 * What a check returns: one bundle, however much it found. `about` is the
 * claim that holds when nothing is found ("no transcript has stalled"); the
 * text leads with it either way, and `error{code}` carries the level for a
 * caller that has to act on it.
 *
 * One bundle rather than one per finding, deliberately: the runner writes what
 * a tool returns, and a sweep that created an entity per stale lease would
 * fill the graph with reports that the graph is untidy.
 */
export let checked = (
  call: Eid,
  about: string,
  found: Finding[],
): Bundle[] => {
  let level = worst(found)
  return [{
    entity: { eid: '$check' },
    ...level ? { error: { code: level } } : {},
    content: {
      // `about` is what holds when the check finds nothing, so a check that
      // found something says it against that claim rather than under it.
      body: found.length
        ? [`${found.length} finding(s) against: ${about}`, ...found.map(said)]
          .join('\n')
        : `${about} — nothing to report`,
    },
    output: { source: call },
  }]
}

let said = (f: Finding): string => `- ${f.level}: ${f.text}`

/** Whether a check's answer reports a measured violation — what the CLI turns
 * into an exit code, and what a scheduled sweep looks for. */
export let ailing = (answer: Bundle[]): boolean =>
  answer.some((b) => (b.error as Comp | undefined)?.code == 'fail')
