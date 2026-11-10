// A tool's validation, caller identity, answer and fault, independent of persistence.
import type { Bundle, Comp, Graph, NamedTool } from '@yaks/graph'
import { who } from '@yaks/graph/call'
import { signed } from '@yaks/graph/provenance'
import { status } from '@yaks/graph/errors'
import { asking } from '@yaks/graph/asker'
import type { Opts, Refusal } from './runner.ts'
import { CallError, parsed, resolved, validated } from './args.ts'
import { Interrupted } from './errors.ts'
import { actionable, exceptionOf } from './fault.ts'
import { MOST } from './result.ts'
import { said } from './said.ts'

/** What a call cut off before its arguments were finished (`cut`) is
 * answered: nothing ran, and how its writer, a model, fits it in a reply. */
export let CUT = 'This call was cut off: your reply reached its output limit ' +
  'while writing it, so its arguments were incomplete and nothing ran. Make ' +
  'it again with less in one reply: think less before it, and split a long ' +
  'script or file across several smaller calls.'

/** What a rehearsal says after the batch it answers. */
let CHECKED = 'Checked: nothing was written. Its eids were made for ' +
  'this check alone; the same call without check writes it, under eids of ' +
  'its own.'

export type Land = (
  made: Bundle[],
  state: string,
  keeps?: boolean,
  code?: string,
) => Bundle[] | Promise<Bundle[]>
// An answer too long to send whole is refused, and so never reaches a door
// that would build its JSON in one string. It is measured one bundle at a
// time, stopping once past `most`, so measuring any answer costs at most that.
let measured = (answer: Bundle[], most: number) => {
  let size = 0
  for (let b of answer) {
    size += JSON.stringify(b).length
    if (size > most) {
      throw new CallError(
        'too_large',
        `the answer is ${answer.length} entities, past the ${most} ` +
          'characters of JSON a call answers in: ask for fewer',
      )
    }
  }
}

/** What an error refuses, when it is a refusal: a `CallError` with its code,
 * or an error the graph's `status` puts below 500 (a `Refused` write, an
 * `Unknown` name) with its name, each in its own words. Anything else is a
 * defect, and refuses nothing. */
export let refusalOf = (error: unknown): Refusal | undefined => {
  let code = error instanceof CallError
    ? error.code
    : status(error) < 500
    ? (error as Error).name
    : undefined
  if (code == undefined) return undefined
  return { code, said: (error as Error).message || String(error) }
}

/** Tell whoever hears refusals of one, reporting a hearer that fails rather
 * than letting it change the call's answer. */
export let heard = async (
  opts: Pick<Opts, 'report' | 'refused'>,
  refusal: Refusal,
  call: Bundle,
  tool?: string,
): Promise<void> => {
  try {
    await opts.refused?.(refusal, call, tool)
  } catch (e) {
    await opts.report?.(e, call, tool)
  }
}

/** Invoke once, letting the owner retain the answer or return it in memory. */
export let invoke = async (
  call: Bundle,
  tool: NamedTool,
  g: Graph,
  opts: Pick<Opts, 'host' | 'process' | 'report' | 'refused' | 'most'>,
  land: Land,
): Promise<Bundle[]> => {
  let id = call.entity.eid
  let host = opts.host ?? g
  let c = call.call as Comp
  // What a thrown error becomes: the fault as its own entity, recording
  // which call it came from. An expected refusal ({@link refusalOf}) gets
  // `refusal{code}` and is told to whoever hears refusals. Anything else is
  // a defect, reported with its original thrown value.
  let faulted = async (error: unknown): Promise<Bundle[]> => {
    if (error instanceof Interrupted) {
      return [{
        entity: { eid: '$fault' },
        content: { body: String(error) },
        output: { source: id },
        ...(g.vocab.comp('notice') ? { notice: {} } : {}),
      }]
    }
    let refusal = refusalOf(error)
    if (!refusal && actionable(String(exceptionOf(error).value))) {
      await opts.report?.(error, call, tool.name)
    }
    if (refusal) await heard(opts, refusal, call, tool.name)
    // A refusal is said in its own words, which its code already classes;
    // a defect keeps the name of what was thrown.
    return [{
      entity: { eid: '$fault' },
      content: { body: refusal?.said ?? String(error) },
      output: { source: id },
      ...refusal
        ? { refusal: { code: refusal.code } }
        : { exception: exceptionOf(error) },
    }]
  }
  let answered: Bundle[]
  try {
    // An unfinished call's arguments are not what its writer meant: whatever
    // they spell, it is refused for what it is.
    if (call.cut) throw new CallError('cut', CUT)
    let args = await resolved(tool, validated(tool, parsed(c.args)), host)
    let actor = who(call)
    let called: Bundle = {
      ...call,
      call: { ...c, args },
      ...!call.created && actor ? { created: { ...actor } } : {},
      ...opts.process ? { process: opts.process } : {},
    }
    // What the tool starts answers it, and the session that called it.
    let made = await asking(
      { door: tool.name, ...actor?.via && { session: actor.via } },
      () => tool.run(called, host),
    )
    if (!tool.applied) made = signed(made, actor)
    measured(made, opts.most ?? MOST)
    // A rehearsal: `check: true` to a tool that writes runs the write's
    // every phase and rolls it back, so the answer is the batch as a kept
    // write would have returned it, or the refusal it would have met. It
    // says so after the batch, since otherwise it reads as the write itself,
    // eids and stamps and all: a caller that took one for the other wrote
    // twice, or never. A tool that answers only its own words about the call
    // has those words to say instead: it handled `check` itself (a session's
    // tool, whose graph call ran a rehearsal of its own and said so).
    if (!tool.readOnly && !tool.applied && args.check === true) {
      let rehearsed = await g.apply(made, { check: true })
      let reported = made.length > 0 &&
        made.every((b) =>
          b.entity.eid[0] == '$' && (b.output as Comp | undefined)?.source == id
        )
      answered = await land(
        reported ? rehearsed : [...rehearsed, said(call, CHECKED)],
        'done',
        false,
      )
    } else {
      answered = await land(made, 'done')
    }
  } catch (error) {
    // This catches both the tool's own throw and a rejection of what it
    // returned: a transaction the graph refuses is this call's failure,
    // rather than a call left claimed with nothing recorded about it.
    let made = await faulted(error)
    answered = await land(
      made,
      error instanceof Interrupted ? 'interrupted' : 'failed',
      undefined,
      error instanceof Interrupted ? error.code : undefined,
    )
  }
  return answered
}
