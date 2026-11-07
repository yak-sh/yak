// What breaks in the shell reaches the tracker, through the door a platform
// page reports to: the apex's `/api/report` (workers/yak/page-report.ts),
// which files a report as the shell's when it names one of its variants. Each
// is tagged with the variant, the update it runs and the commit that update
// was published from, where it is caught: a view that throws, a view that
// would not load, a socket that will not reopen, an error nothing caught, a
// rejection nobody handled, and a launch of the embedded bundle because the
// update crashed. A phone with no network, and a refusal of the person's own
// input, are no break.
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { APEX, variant } from './yaks.ts'

type Mechanism = 'catch' | 'onerror' | 'onunhandledrejection'
type Crumb = { at: string; category: string; message: string }

// Where the shell is, as the page it shows: what a break happened on.
let at = APEX
let crumbs: Crumb[] = []
let crumb = (category: string, message: string) => {
  crumbs = [...crumbs, { at: new Date().toISOString(), category, message }]
    .slice(-20)
}

/** The shell now shows `url`: a tab, an app, or one of a space's pages. */
export let went = (url: string) => {
  at = url
  crumb('navigation', url)
}

let tags = () => {
  let extra = Constants.expoConfig?.extra
  let kept = {
    variant: variant.key,
    version: Constants.expoConfig?.version,
    update: Updates.updateId ?? 'embedded',
    channel: Updates.channel,
    runtime: Updates.runtimeVersion,
    commit: extra?.commit,
  }
  return Object.fromEntries(
    Object.entries(kept).filter(([, v]) => typeof v == 'string' && v),
  )
}

let said = (e: unknown) =>
  e instanceof Error ? e.stack || `${e.name}: ${e.message}` : String(e)

// What an error was wrapped around, down its `cause` chain, as a page's
// reporter keeps it (@yaks/tracker/page `causes`).
let causes = (e: unknown) => {
  let out: string[] = []
  let seen = new Set([e])
  for (
    let c = (e as Error)?.cause;
    c != null && !seen.has(c) && out.length < 5;
    c = c instanceof Error ? c.cause : undefined
  ) {
    seen.add(c)
    out.push(said(c))
  }
  return out.join('\nCaused by: ').slice(0, 4000)
}

// React Native's words for a fetch that had no answer: the phone offline, or
// the server away, which is seen by its own reporting.
let unanswered = (e: unknown) =>
  e instanceof TypeError && e.message == 'Network request failed'

// A view that throws on every render must not become a write loop.
let sent = 0

/** Report `e` to the tracker; never throws, and settles within five seconds,
 * so a fatal error may wait for it before the shell goes down. */
export let report = (
  e: unknown,
  mechanism: Mechanism = 'catch',
): Promise<void> => {
  console.warn(e)
  if (unanswered(e) || sent++ >= 20) return Promise.resolve()
  let message = (e instanceof Error ? e.message : String(e)).slice(0, 4000)
  let cause = causes(e)
  let body = JSON.stringify({
    type: 'shell',
    message,
    stack: e instanceof Error ? e.stack : undefined,
    ...cause ? { cause } : {},
    mechanism,
    page: at,
    breadcrumbs: crumbs,
    tags: tags(),
  })
  return fetch(`${APEX}/api/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5000),
  }).then(() => {}, () => {})
}

type Tracker = {
  enablePromiseRejectionTracker?: (o: {
    allRejections: boolean
    onUnhandled: (id: number, rejection: unknown) => void
  }) => void
}

/** Report what nothing caught: an error, which still takes the shell down
 * where it would have, once its report is sent; a rejection nobody handled;
 * and a launch that fell back to the embedded bundle because the update it
 * had crashed it. */
export let listen = () => {
  let prior = ErrorUtils.getGlobalHandler()
  ErrorUtils.setGlobalHandler((e, fatal) => {
    let sending = report(e, 'onerror')
    if (fatal) sending.then(() => prior(e, fatal))
    else prior(e, fatal)
  })
  let hermes = (globalThis as { HermesInternal?: Tracker }).HermesInternal
  hermes?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_, rejection) => report(rejection, 'onunhandledrejection'),
  })
  if (Updates.isEmergencyLaunch) {
    report(
      new Error(
        `The update crashed the shell, which launched its embedded bundle: ${Updates.emergencyLaunchReason}`,
      ),
      'onerror',
    )
  }
}
