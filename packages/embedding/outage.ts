// When a model that does not answer is a failure.
//
// A provider out past its retries (./remote.ts `retrying`) throws
// `Unanswered`, and the texts it was asked for stay owed: the next drain
// embeds them once the model answers, so a host's drains ride an outage out
// on their own. What a person loses meanwhile is search by meaning: an owed
// text is found by its words, but not by `.near` or a recall. So an outage is
// a line in the log when it starts and when it ends, and a failure once the
// texts it holds up have waited {@link OVERDUE}: reported once, the outage as
// its cause. Anything else a drain throws is unexpected and reports at once,
// and once while drains keep failing by it: a box drains every few seconds,
// and one bug is one report. The drain that next answers logs that it did.
// A text the model refuses is the text's, not the drain's (./sweep.ts
// `refused`). A model `Withheld` (a host's spent budget) is no failure at
// all: its texts wait for the ceiling to lift, logged once, never reported.
//
// It is @yaks/mail's delayed letter (pull.ts) for vectors: what fails is the
// wait, not each try. The outage is a value the host keeps between drains; a
// Durable Object keeps it in its own storage, since it sleeps between the
// alarms that retry.

import { Unanswered, Withheld } from './embedder.ts'

/**
 * How long owed texts may wait on a model that does not answer before the
 * wait is a failure. A drain retries about once a minute, and the Workers AI
 * outages the stores have met passed within a few minutes; a quarter of an
 * hour is several times that, and as long as a person's searches by meaning
 * should go without a new text before someone hears of it.
 */
export let OVERDUE: number = 15 * 60_000

/** An outage a host's drains are riding out: since when no drain has
 * answered, whether the wait has been reported or, withheld, needs no report,
 * and the unexpected failure already reported, while drains keep failing by
 * it. */
export type Outage = { since: number; told?: true; bug?: string }

/** What one drain's outcome makes of the outage: the outage it leaves, the
 * failure to report and the line to log, where there is one. */
export type Rode = { outage: Outage | null; report?: unknown; log?: string }

/** One drain's outcome, given the outage it met and when it ended. */
export type Ride = (outage: Outage | null, now: number) => Rode

/** What a report of owed texts waiting past {@link OVERDUE} throws: a fixed
 * message, since one outage is one failure however long it lasts or whatever
 * the model said; what varies rides `context`, and the model's last failure
 * is the `cause`. */
export class Overdue extends Error {
  override name = 'Overdue'
  context: Unanswered['context'] & { waited: string }
  constructor(waited: number, cause: Unanswered) {
    super('@yaks/embedding: owed texts waited too long for their vectors', {
      cause,
    })
    this.context = { ...cause.context, waited: `${waited} ms` }
  }
}

/**
 * A drain that answered: an outage it rode out, or the failure it reported,
 * is over.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * equal(drained(null, 0), { outage: null })
 * equal(drained({ since: 0 }, 90_000),
 *   { outage: null, log: 'the outage ended after 90000 ms' })
 * equal(drained({ since: 0, bug: 'Error: no table' }, 9_000), {
 *   outage: null,
 *   log: 'drains answer again after 9000 ms of Error: no table',
 * })
 * ```
 */
export let drained: Ride = (outage, now) => {
  if (!outage) return { outage }
  let ms = now - outage.since
  return {
    outage: null,
    log: outage.bug
      ? `drains answer again after ${ms} ms of ${outage.bug}`
      : `the outage ended after ${ms} ms`,
  }
}

/**
 * A drain that threw `error`. A model that did not answer starts an outage or
 * rides on in one, until its texts have waited {@link OVERDUE}, which reports
 * once; a model that withheld its answer waits without a report; anything
 * else reports at once, and not again while drains keep failing by it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { Unanswered } from './embedder.ts'
 * let down = new Unanswered('workers-ai',
 *   { model: '@cf/m', texts: '2', tries: '4' }, Error('4009'))
 * equal(failed(down)(null, 0).outage, { since: 0 })
 * equal(failed(down)({ since: 0 }, 60_000), { outage: { since: 0 } })
 * let bug = failed(Error('no table'))
 * equal(bug(null, 0).outage, { since: 0, bug: 'Error: no table' })
 * equal(bug(bug(null, 0).outage, 3_000).report, undefined)
 * ```
 */
export let failed = (error: unknown): Ride => (outage, now) => {
  if (error instanceof Withheld) {
    return outage ? { outage: { ...outage, told: true } } : {
      outage: { since: now, told: true },
      log: `${error.message}; its texts wait until it lifts`,
    }
  }
  if (!(error instanceof Unanswered)) {
    let bug = String(error)
    if (outage?.bug == bug) return { outage }
    return { outage: { ...outage ?? { since: now }, bug }, report: error }
  }
  if (!outage) {
    return {
      outage: { since: now },
      log:
        `${error.message} (${error.cause}); its texts wait for the next drain`,
    }
  }
  let waited = now - outage.since
  if (outage.told || waited < OVERDUE) return { outage }
  return {
    outage: { ...outage, told: true },
    report: new Overdue(waited, error),
  }
}
