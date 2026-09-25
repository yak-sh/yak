// What a signal does to a `yak` command: a request to wind down, not a crash.
// SIGTERM is how systemd stops `yak serve`, SIGINT a person's ctrl-c, SIGHUP a
// terminal going away. Left to the runtime, each of them ends the process
// where it stands, and a graph it had open keeps a `process` row with no
// `exit`, leases nobody releases until they run out, and calls claimed by a
// process that is gone.
//
// So the first signal asks every graph the command opened to stop (local.ts
// `stop`): a server stops taking requests and answers the ones in flight, a
// duty stops at its next check, and the command returns and closes the way it
// always does. A second signal, or the grace running out first, closes what is
// open with the signal's code and ends the process there; closing ends any
// call still running as interrupted (host.ts `close`). A command with nothing
// open has nothing to wind down, and ends at once.

/** The signals a command winds down on, and the code each ends it with: 128
 * plus the signal's number, as a shell reports it. Windows delivers SIGINT
 * alone. */
export let SIGNALS: [Deno.Signal, number][] = Deno.build.os == 'windows'
  ? [['SIGINT', 130]]
  : [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]

/** How long a command has to wind down before it is closed where it stands:
 * inside systemd's 90 s stop timeout, so the ending is written before a
 * SIGKILL could take the chance away. */
export let GRACE = 30_000

/** What winding down acts on. */
export type Winding = {
  /** ask what is open to wind down; false when nothing is */
  stop: () => boolean
  /** close what is open, ending it with this code */
  close: (code: number) => Promise<void>
  /** end the process */
  exit: (code: number) => void
  /** how long the first signal waits before closing anyway (ms) */
  grace?: number
}

/** The handler for one signal's code: the first asks, a second or the grace
 * ends. */
export let winding = (o: Winding): (code: number) => void => {
  let asked = false
  let ending: Promise<void> | undefined
  let end = (code: number) =>
    ending ??= o.close(code).catch(() => {}).then(() => o.exit(code))
  return (code) => {
    if (asked || !o.stop()) return void end(code)
    asked = true
    let timer = setTimeout(() => end(code), o.grace ?? GRACE)
    // A command that winds down in time exits on its own; the timer must not
    // be what keeps it alive.
    Deno.unrefTimer(timer)
  }
}

/** Listen for {@link SIGNALS}; the function returned stops listening. */
export let listen = (on: (code: number) => void): () => void => {
  let heard = SIGNALS.map(([s, code]) => [s, () => on(code)] as const)
  for (let [s, fn] of heard) Deno.addSignalListener(s, fn)
  return () => heard.forEach(([s, fn]) => Deno.removeSignalListener(s, fn))
}
