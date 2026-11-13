// A wake set for a person that carries a tool call (`call{to, args}`, from
// @yaks/tools) runs it at each firing with no model turn, as that person, and
// keeps a record of the run: an `occurrence{wake, at, call, error}` entity,
// one a firing, whose eid is derived from the wake and the instant it fired,
// so a replay of the same firing, or a second driver, finds it and runs
// nothing twice. The call is its own entity, derived from the occurrence, and
// @yaks/tools keeps its answer, so a retry reuses an answer already recorded.
//
// The host lends what only it has: a runner over the tools the person may use
// as they stand when it fires (their permissions are read then, not when the
// wake was set), and anything else the occurrence is written with (the
// Operator's is also the session its helper runs in). How the occurrence ends
// is the host's to mark, `completed` or `failed`, since a helper given the
// wake's brief may still be checking it.
//
// This entry point imports @yaks/tools; the core (`@yaks/wake`) does not.

import {
  type Bundle,
  type Comp,
  derivedEid,
  type Eid,
  type Graph,
} from '@yaks/graph'
import { answerOf, faulted, type Runner, worded } from '@yaks/tools'
import { OCCURRENCE, type Occurrence } from './comp.ts'

type G = Pick<Graph, 'get' | 'apply'>

/** The most characters of a call's answer an occurrence says. */
export let SAID = 16_384

/** The occurrence a wake's firing at `at` records. */
export let occurrenceOf = (wake: Eid, at: string): Eid =>
  derivedEid(`occurrence ${wake} ${at}`)

/** What one firing's call came to: its occurrence, the answer in words, and
 * the failure where it failed. */
export type Ran = { occurrence: Eid; text: string; error?: string }

/** What the host lends a firing. */
export type Host = {
  /** the runner the call is made through, over the person's tools as they
   * stand now; given the occurrence the call is made for */
  runner: (occurrence: Eid) => Runner | Promise<Runner>
  /** what else the occurrence is written with */
  with?: Omit<Bundle, 'entity'>
  /** the writer the call is made as */
  actor?: Bundle['$actor']
}

// A call that answered may still report a failure inside its answer: a
// script's error, or a nested call that failed or had not finished (code_mode
// answers with its receipts).
let inner = (out: Bundle[]): string | undefined => {
  for (let answer of out) {
    let outer = (answer.output as Comp | undefined)?.value as Comp | undefined
    let value = (outer?.structuredContent ?? outer) as Comp | undefined
    let calls = value?.calls as Comp[] | undefined
    if (value?.error || calls?.some((c) => c.isError || c.pending)) {
      return String(value?.error ?? 'A nested call failed or has not finished.')
    }
  }
}

/**
 * Record a wake's firing at `at` and run the call it carries, once: answers
 * the occurrence and what the call said, with its failure, or `undefined`
 * when the occurrence already ended. A wake with no call is recorded and
 * answers that nothing was called.
 */
export let run = async (
  g: G,
  wake: Bundle,
  at: string,
  host: Host,
): Promise<Ran | undefined> => {
  let id = occurrenceOf(wake.entity.eid, at)
  let [held] = await g.get([id])
  if (held?.completed || held?.failed) return
  let asked = wake.call as Comp | undefined
  let call = asked ? derivedEid(`call ${id}`) : undefined
  if (!held) {
    let occurrence: Occurrence = {
      wake: wake.entity.eid,
      at,
      ...call ? { call } : {},
    }
    await g.apply([{
      entity: { eid: id },
      ...host.with,
      [OCCURRENCE]: occurrence,
    }], { trusted: true })
  }
  if (!call) return { occurrence: id, text: 'Nothing was called.' }
  let text: string, error: string | undefined
  try {
    let answered = await (await host.runner(id)).call({
      entity: { eid: call },
      call: { ...asked, source: id },
      ...host.actor ? { $actor: host.actor } : {},
    })
    let out = answerOf(answered, call)
    text = worded(out, SAID)
    let [stored] = await g.get([call])
    if (faulted([stored, ...answered], call)) error = text
    error = inner(out) ?? error
  } catch (e) {
    text = error = e instanceof Error ? e.message : String(e)
  }
  if (error) {
    await g.apply([{ entity: { eid: id }, [OCCURRENCE]: { error } }], {
      trusted: true,
    })
  }
  return { occurrence: id, text, ...error ? { error } : {} }
}
