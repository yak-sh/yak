// A CHECK is a tool whose verb is `check`, and that is the whole of "the
// doctor": not a registry anybody adds a row to, but every tool the loaded
// vocabulary declares with that verb. A host composes a plugin and its checks
// arrive with it; a host that drops one drops its checks too. There is no list
// to fall out of date, and no package owning other packages' invariants.
//
// What a check ANSWERS is an ordinary tool answer — prose on `content{body}`
// saying which call it came from — with one word added: `error{code}` when it
// found something, `fail` for a measured violation of a contract the package
// keeps and `warn` for a leak, or for a verdict it could not verify. A listing
// of faults is not a fault (`faulted` in ./runner.ts reads the CALL's own
// state), so a check that finds a sick graph still SUCCEEDED, and a caller
// reads the level rather than an exit code it had to guess at.
//
// Two rules that come from the fleet doctor this replaces: a check that finds
// nothing still answers (silence is indistinguishable from a check that never
// ran), and a check that cannot run says so as a `warn` rather than passing
// quietly.

import type { Bundle, Comp, Eid } from '@yaks/graph'

/** The verb that makes a tool a check. */
export let CHECK = 'check'

/** How bad a finding is: `fail` is measured — a contract this package keeps is
 * broken. `warn` is a leak, or a verdict the check could not verify. */
export type Level = 'fail' | 'warn'

/** One thing a check found. `text` is for a person: what is wrong, about what,
 * and what it costs. */
export type Finding = { level: Level; text: string }

/** The checks among some tools — every one whose verb is `check`. The
 * declarations a host already holds (`@yaks/graph/tools` `loadTools` keeps
 * `noun`/`verb` on each), so nothing else has to be registered or kept. */
export let checks = <T extends { verb?: string }>(tools: T[]): T[] =>
  tools.filter((t) => t.verb == CHECK)

// The worst thing said, or nothing said at all. A check with one `fail` among
// its warnings is failing.
let worst = (found: Finding[]): Level | undefined =>
  found.some((f) => f.level == 'fail')
    ? 'fail'
    : found.length
    ? 'warn'
    : undefined

/**
 * What a check answers: ONE bundle, whatever it found. The prose leads with
 * what was checked, so an answer reads the same whether it is empty or long,
 * and `error{code}` carries the level for a caller that has to decide
 * something.
 *
 * One bundle rather than one per finding on purpose: the runner LANDS what a
 * tool answers, and a sweep that mints an entity per stale lease would fill
 * the graph with the news that the graph is untidy.
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
      body: found.length
        ? [`${about} — ${found.length} finding(s)`, ...found.map(said)].join(
          '\n',
        )
        : `${about} — nothing to report`,
    },
    output: { source: call },
  }]
}

let said = (f: Finding): string => `- ${f.level}: ${f.text}`

/** Whether a check's answer reports a measured violation — what a command
 * line's exit code is, and what a fleet's morning read looks for. */
export let ailing = (answer: Bundle[]): boolean =>
  answer.some((b) => (b.error as Comp | undefined)?.code == 'fail')
