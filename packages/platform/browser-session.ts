// A browser session belongs to the visit from allocation through release.
import { type Clock, type Hold, sleep } from '@yaks/fp'
import { bounded, BrowserTimeout } from './browser-time.ts'

export type Sessions<B> = {
  acquire(signal: AbortSignal): Promise<string>
  connect(session: string, signal: AbortSignal): Promise<B>
  release(session: string): Promise<void>
}

export type SessionOptions = {
  hold: Hold
  report: (error: unknown) => void
  progress?: (stage: string) => void
}

export let OPEN = 8_000
export let CONNECT = 3_000
export let RELEASE = 2_000

let retried = async <T>(
  run: () => Promise<T>,
  pauses: number[],
  time: Clock,
  signal: AbortSignal,
  again: (error: unknown) => boolean = () => true,
): Promise<T> => {
  for (let pause of pauses) {
    signal.throwIfAborted()
    try {
      return await run()
    } catch (e) {
      if (!again(e)) throw e
      await sleep(pause, signal, time)
    }
  }
  signal.throwIfAborted()
  return run()
}

let temporary = (error: unknown) =>
  error instanceof Error &&
  /^Unable to create new browser: code: 5\d\d:/.test(error.message)

let released = async (
  browsing: Sessions<unknown>,
  id: string,
  time: Clock,
  hold: Hold,
  report: (error: unknown) => void,
) => {
  let work = Promise.resolve().then(() => browsing.release(id))
  try {
    await bounded(
      time,
      RELEASE,
      () => 'Releasing the browser session',
      () => work,
    )
  } catch (e) {
    report(e)
    if (e instanceof BrowserTimeout) hold(work.catch(report))
  }
}

// A late allocation still belongs to this visit. Release it without opening
// a connection, even after the caller has received its timeout.
let acquired = (
  browsing: Sessions<unknown>,
  left: () => number,
  time: Clock,
  hold: Hold,
  report: (error: unknown) => void,
) =>
  bounded(
    time,
    Math.min(OPEN, left()),
    () => 'Acquiring a browser session',
    (signal) => {
      let work = retried(
        () => browsing.acquire(signal),
        [1000, 2000, 4000],
        time,
        signal,
        temporary,
      )
      signal.addEventListener('abort', () => {
        hold(work.then(
          (id) => released(browsing, id, time, hold, report),
          () => {},
        ))
      }, { once: true })
      return work
    },
  )

export let withSession = async <B, T>(
  sessions: Sessions<B>,
  openBy: number,
  time: Clock,
  { hold, report, progress }: SessionOptions,
  run: (browser: B) => Promise<T>,
): Promise<T> => {
  let left = () => openBy - time.now()
  let release = (id: string) => {
    progress?.('releasing the browser session')
    return released(sessions, id, time, hold, report)
  }
  let open = async (replace: boolean): Promise<{ id: string; browser: B }> => {
    progress?.('acquiring a browser session')
    let id = await acquired(sessions, left, time, hold, report)
    try {
      progress?.('connecting to the browser session')
      let browser = await bounded(
        time,
        Math.min(CONNECT, left()),
        () => 'Connecting to the browser session',
        (signal) =>
          retried(
            () => sessions.connect(id, signal),
            [250, 500, 1000],
            time,
            signal,
          ),
      )
      return { id, browser }
    } catch (e) {
      await release(id)
      if (e instanceof BrowserTimeout) throw e
      if (!replace) {
        throw new Error('Could not connect to a fresh browser session', {
          cause: e,
        })
      }
      report(
        new Error(
          `Replacing a browser session that could not connect (${
            e instanceof Error ? e.message : e
          })`,
          { cause: e },
        ),
      )
      return open(false)
    }
  }
  let { id, browser } = await open(true)
  try {
    return await run(browser)
  } finally {
    await release(id)
  }
}
