// How this process ends when it is asked to: wound down, not cut off, unless
// it is asked twice.
//
// An interrupt is a signal (SIGTERM from a service manager, SIGINT from
// ctrl-c, SIGHUP from a terminal going away) or a ctrl-c typed into a raw
// terminal (@yaks/tui). Whatever keeps the process open holds it
// ({@link Hold}): the graphs a command opened, a terminal it paints, a backend
// a view runs. The first interrupt asks every hold to drain: take nothing new
// and let what it started finish. Nothing here puts a clock on that, because
// only the work knows how long it needs. The second interrupt forces: what is still going is ended where it
// stands. Once every hold has answered, the process is done, with the code of
// the interrupt that ended it.
//
// A signal is the whole process's, so there is one wind per process
// ({@link wind}): a command line, the terminal it draws and the graphs it
// opened all answer the same interrupt.

/** What holds the process open while it winds down. */
export type Hold = {
  /** take nothing new and finish what was started; settles once finished */
  drain: () => unknown
  /** end what is still going, where it stands */
  force?: () => unknown
}

/** A process winding down: what holds it, and the interrupts it hears. */
export type Wind = {
  /** hold the process open while it winds down; the function returned lets
   * go */
  hold: (h: Hold) => () => void
  /** an interrupt: the first drains every hold, a second forces them. `code`
   * is what the process ends with, 128 plus a signal's number. */
  interrupt: (code: number) => void
  /** whether an interrupt has come */
  readonly draining: boolean
  /** settles with the code once every hold has drained, or been forced */
  done: Promise<number>
}

/**
 * A wind of its own, for a test; a process has {@link wind}.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { winding } from '@yaks/process/wind'
 *
 * let w = winding()
 * let said: string[] = []
 * w.hold({ drain: () => said.push('drain'), force: () => said.push('force') })
 * w.interrupt(143)
 * assertEquals([await w.done, said], [143, ['drain']])
 * ```
 */
export let winding = (): Wind => {
  let holds = new Set<Hold>()
  let state: 'open' | 'draining' | 'forced' | 'done' = 'open'
  let end = Promise.withResolvers<number>()
  // Every hold asked at once; one that throws has still answered.
  let each = (ask: (h: Hold) => unknown) =>
    Promise.allSettled([...holds].map(async (h) => await ask(h)))
  return {
    hold: (h) => {
      holds.add(h)
      return () => void holds.delete(h)
    },
    get draining() {
      return state != 'open'
    },
    done: end.promise,
    interrupt: (code) => {
      if (state == 'open') {
        state = 'draining'
        each((h) => h.drain()).then(() => {
          if (state != 'draining') return
          state = 'done'
          end.resolve(code)
        })
      } else if (state == 'draining') {
        state = 'forced'
        each((h) => h.force?.()).then(() => end.resolve(code))
      }
    },
  }
}

/** This process's wind. */
export let wind: Wind = winding()

/** The signals a process winds down on, and the code each ends it with: 128
 * plus the signal's number, as a shell reports it. Windows delivers SIGINT
 * alone. */
export let SIGNALS: [Deno.Signal, number][] = Deno.build.os == 'windows'
  ? [['SIGINT', 130]]
  : [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]

// The winds already listening, so a second listener does not make one signal
// two interrupts.
let heard = new WeakSet<Wind>()

/** Hear {@link SIGNALS} as interrupts of `w`. Whoever listens first listens
 * for the process, and the function returned stops; listening again is a
 * no-op. */
export let listen = (w: Wind = wind): () => void => {
  if (heard.has(w)) return () => {}
  heard.add(w)
  let on = SIGNALS.map(([s, code]) => [s, () => w.interrupt(code)] as const)
  for (let [s, fn] of on) Deno.addSignalListener(s, fn)
  return () => {
    heard.delete(w)
    for (let [s, fn] of on) Deno.removeSignalListener(s, fn)
  }
}
