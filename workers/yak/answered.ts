// The lines a store has answered, so that a refusal can say whose it is.
//
// A line compiles from three things: the line, the words the store holds (its
// app's vocabulary and the words it uses from other homes), and the platform's
// code. The line and the words are the caller's side; the code is ours. So a
// line this store answered under the words it holds now, refused today, was
// refused by code that changed since: a deploy, whoever sent it (a page's own
// code, the kernel composing a read, a connector call). That refusal is ours,
// reported where it is made as `Regressed`, and the caller still hears the
// refusal it would have heard. A line never answered under these words stays
// the caller's: a typo, a word the app dropped, a shape nothing compiled.
//
// The memory is one slot: a print of the words, and the lines answered under
// them, each by a short hash. New words start it over. It keeps the first
// REMEMBERED lines; the ones shipped code sends are asked again and again, so
// they are among the first, and a line typed once may go unkept.
//
// A new line is written to the slot behind its answer, once the caller has
// read it through (`recalling`'s `behind`): a store's answer waits for every
// write made before it to be confirmed, and that write held each read of a
// new line 20-30 ms past the store's own work (T-150127). Lines answered
// together are written together, and an object that stops before the write
// forgets them, as it forgets a line past REMEMBERED.
import { sha256 } from '@yaks/graph/sha256'
import { onceRead } from './running.ts'

/** The names a line is refused with when it does not compile (@yaks/query's
 * parser, @yaks/sql, @yaks/match, @yaks/vocab). */
let COMPILES = new Set(['SyntaxError', 'Unknown', 'Unsupported'])

/** How many lines a store keeps under one set of words. */
export let REMEMBERED = 512

/** A line this store answered before under the same words, refused now. */
export class Regressed extends Error {
  constructor(refusal: string) {
    super(`a query this store answered before is refused: ${refusal}`)
    this.name = 'Regressed'
  }
}

type Slot = { read: () => string | null; write: (value: string) => void }
type Held = { words: string; lines: Set<string> }

let short = (text: string) => sha256(text).slice(0, 16)

/** The memory over `slot`: which lines were answered under which words. The
 * words are the texts the store holds them as, printed once while they stay
 * the same strings. */
export let answers = (slot: Slot) => {
  let held: Held | undefined
  let was: string[] = []
  let print = ''
  let printed = (words: string[]) => {
    if (words.length != was.length || words.some((w, i) => w !== was[i])) {
      was = words
      print = short(words.join('\n'))
    }
    return print
  }
  let under = (words: string[]) => {
    let at = printed(words)
    if (!held) {
      let said = JSON.parse(slot.read() ?? 'null') as
        | { words: string; lines: string[] }
        | null
      held = { words: said?.words ?? '', lines: new Set(said?.lines) }
    }
    if (held.words != at) held = { words: at, lines: new Set() }
    return held
  }
  let unkept = false
  return {
    /** Note a line answered under `words`; true when that is news the slot
     * does not hold yet (`keep`). */
    answered: (words: string[], line: string): boolean => {
      let { lines } = under(words)
      let key = short(line)
      if (lines.has(key) || lines.size >= REMEMBERED) return false
      lines.add(key)
      return unkept = true
    },
    /** Write what was answered since the last write, if anything was. */
    keep: () => {
      if (!unkept || !held) return
      unkept = false
      slot.write(JSON.stringify({ words: held.words, lines: [...held.lines] }))
    },
    regressed: (words: string[], line: string, name: unknown) =>
      COMPILES.has(String(name)) && under(words).lines.has(short(line)),
  }
}

let named = (e: unknown) => e instanceof Error ? e.name : undefined
let said = (e: unknown) => e instanceof Error ? e.message : String(e)

/** A query door that remembers what it answers: `answer` for `line` under
 * `words`, as it was. An answer is remembered, kept in the slot by the work
 * `behind` runs once the caller has read it through, and a refusal of a line
 * remembered is reported to `report`, which also hears a memory that could
 * not be kept. A refusal thrown or answered (a 400 whose body names it) is
 * the same refusal. */
export let recalling = (
  memory: ReturnType<typeof answers>,
  report: (error: unknown) => void,
  behind: (work: () => void) => void,
) =>
async (
  words: string[],
  line: string,
  answer: () => Response | Promise<Response>,
): Promise<Response> => {
  let refused = (name: unknown, message: string) => {
    if (memory.regressed(words, line, name)) report(new Regressed(message))
  }
  let got: Response
  try {
    got = await answer()
  } catch (e) {
    refused(named(e), said(e))
    throw e
  }
  if (got.ok) {
    let news = false
    try {
      news = memory.answered(words, line)
    } catch (e) {
      report(e)
    }
    if (news) {
      let keep = () => {
        try {
          memory.keep()
        } catch (e) {
          report(e)
        }
      }
      return onceRead(got, () => behind(keep))
    }
  } else if (got.status == 400) {
    let body = await got.clone().json().catch(() => null) as
      | { error?: string; message?: string }
      | null
    refused(body?.error, body?.message ?? '')
  }
  return got
}
