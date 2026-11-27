// What yak-browser does with a request: a page's address, viewport, the
// cookies it is opened with, the steps a person takes on it and, for a page
// not yet deployed, the document it answers with posted in, its
// screenshots, text, console, dialogs, errors, status and accessibility check
// out, with the browser time it held. Browser control runs on Cloudflare; the small
// session interface lets the load, steps, diagnostics and cleanup run in
// process without a local browser.
import { type Clock, type Hold, sleep, system } from '@yaks/fp'
import { CallError } from '@yaks/tools/errors'
import { audit, type Axe, type Checked, interruption } from './preview-audit.ts'
import { FIT, type Fit } from './preview-fit.ts'
import { bounded, BrowserTimeout } from './browser-time.ts'
import { tracing } from './browser-trace.ts'
import {
  HTML_BYTES,
  HTML_LIMIT,
  PROGRESS,
  readAsk,
  WIRE,
} from './browser-wire.ts'
import { type Screens, streamBrowse } from './browser-stream.ts'
import { holding } from '@yaks/blob/stream'
import {
  type MockupAssets,
  mockupAssets,
  type MockupFile,
  mockupPath,
  serveMockup,
} from './browser-mockup.ts'

import {
  CONNECT,
  OPEN,
  RELEASE,
  type SessionOptions,
  type Sessions,
  withSession,
} from './browser-session.ts'

export { CONNECT, OPEN, RELEASE } from './browser-session.ts'
export { bounded, BrowserTimeout } from './browser-time.ts'

/** A window: its size, how long to wait after loading, whether it is a
 * phone's (touch events, a mobile viewport), and whether the system asks for
 * the dark theme. `cpu` slows the processor by that factor and `network`
 * holds the connection to a mobile one (`NETWORKS`), as a slower phone
 * opens the page; `cold` opens it with no cache, service worker or stored
 * data from an earlier visit, as a first open does. `trace` records what
 * the page's main thread did while the steps ran (./browser-trace.ts). */
export type View = {
  width: number
  height: number
  wait: number
  touch?: boolean
  dark?: boolean
  cpu?: number
  network?: Network
  cold?: boolean
  trace?: boolean
}
/** Chrome DevTools' own mobile presets: round trip in ms, and bytes a
 * second each way. */
export let NETWORKS = {
  'slow-4g': { latency: 562.5, down: 1.6e6 / 8 * 0.9, up: 750e3 / 8 * 0.9 },
  'fast-4g': { latency: 165, down: 9e6 / 8 * 0.9, up: 1.5e6 / 8 * 0.9 },
} as const
export type Network = keyof typeof NETWORKS
/** A cookie the page is opened with: a private app's sign-in. One with a
 * `url` and no `domain` is host-only, as a `__Host-` cookie must be. */
export type Cookie = {
  name: string
  value: string
  domain?: string
  url?: string
  path: string
  secure: boolean
  httpOnly: boolean
}
/**
 * One thing a person does on the page, in order after it loads:
 *
 *   tap       press the first element a selector names that shows (a touch
 *             on a phone's view)
 *   type      type text, into the first shown element a selector names or
 *             what has focus
 *   clear     empty the first shown field a selector names, as a person
 *             selecting all of it and deleting does
 *   press     press one key, such as `Enter`
 *   hover     rest the mouse on the first shown element a selector names,
 *             as a person does before pressing it
 *   swipe     drag a finger from one point to another, [x1, y1, x2, y2]
 *   keyboard  a phone's on-screen keyboard opens over this many pixels: the
 *             window shrinks by them, as it does for a page that asks to be
 *             resized (`interactive-widget=resizes-content`); 0 closes it
 *   wait      wait this many milliseconds
 *   shot      take a screenshot, kept under this name
 *   open      open this address, relative to the page, as a person opening
 *             it again does: a warm open, through what the first one cached
 *   push      push this message to the site's service worker, as its push
 *             service would
 *   offline   take the page and its service worker off the network (true),
 *             or back onto it at the view's speed (false)
 *   eval      run this expression in the page, as its own scripts run, and
 *             say what it came to (awaited, as JSON): a measure taken or a
 *             change tried in place
 */
export type Step =
  | { tap: string }
  | { type: string; into?: string }
  | { clear: string }
  | { press: string }
  | { hover: string }
  | { swipe: [number, number, number, number] }
  | { keyboard: number }
  | { wait: number }
  | { shot: string }
  | { open: string }
  | { push: unknown }
  | { offline: boolean }
  | { eval: string }

/** The interaction steps accepted by an app preview. */
export let previewSteps = (value: unknown): Step[] => {
  if (value == null) return []
  let refused = () =>
    new CallError(
      'arguments',
      'steps takes up to six actions: {tap: selector}, {type: text, into?: selector}, {press: key}, or {wait: milliseconds (0–3000)}',
    )
  if (!Array.isArray(value) || value.length > 6) throw refused()
  let word = (v: unknown) => typeof v == 'string' && v.length > 0
  return value.map((step) => {
    if (!step || typeof step != 'object' || Array.isArray(step)) throw refused()
    let keys = Object.keys(step)
    if (
      keys.includes('type') &&
      keys.every((key) => key == 'type' || key == 'into') &&
      typeof step.type == 'string' &&
      (!keys.includes('into') || word(step.into))
    ) return step
    if (keys.length != 1) throw refused()
    let [key] = keys
    if ((key == 'tap' || key == 'press') && word(step[key])) return step
    if (
      key == 'wait' && Number.isInteger(step.wait) && step.wait >= 0 &&
      step.wait <= 3000
    ) return step
    throw refused()
  })
}
/** What yak-browser is asked to open. */
export type Visit = {
  url: string
  view: View
  cookies?: Cookie[]
  steps?: Step[]
  /** Browser permissions the page holds as it opens, such as
   * `notifications`: a headless browser turns every ask down, so a page
   * that offers what a permission allows offers nothing without it. */
  allow?: string[]
  /** Whether axe-core checks the page's accessibility (default true). */
  audit?: boolean
  /** The document `url` answers with, in place of the one its site serves:
   * a page as a checkout renders it, seen before it deploys. Only the first
   * load of the page is answered so; everything the document asks for, and
   * every page a step goes on to, comes from the site. */
  html?: string
}
export type BrowseVisit = Visit & { mockup?: MockupFile[] }
export type Message = {
  type(): string
  text(): string
  location?(): { url?: string }
}
// Cloudflare's edge answers every host's /cdn-cgi/ paths itself, and adds to
// pages what fetches them (Speed Brain's Speculation-Rules header asks for
// /cdn-cgi/speculation, which a sandboxed page's null origin may not read).
// What the browser says about them is the edge's, never the app's.
let EDGE = /\/cdn-cgi\//
/// edge({ type: () => 'error', text: () => "Access to speculation rules at 'https://a.yaks.app/cdn-cgi/speculation' from origin 'null' has been blocked by CORS policy" }) -> true
/// edge({ type: () => 'error', text: () => 'Failed to load resource', location: () => ({ url: 'https://a.yaks.app/cdn-cgi/speculation' }) }) -> true
/// edge({ type: () => 'log', text: () => 'page ready' }) -> false
export let edge = (m: Message) =>
  EDGE.test(m.text()) || EDGE.test(m.location?.().url ?? '')
/** An alert, confirm, prompt or beforeunload dialog the page opened. Input
 * waits while one is open, so a step that opens one would never return. */
export type Dialog = {
  type(): string
  message(): string
  dismiss(): Promise<void>
}
export type PageRequest = {
  url(): string
  isNavigationRequest(): boolean
  frame(): unknown
  respond(answer: {
    status: number
    contentType: string
    body: string | Uint8Array
  }): Promise<void>
  continue(): Promise<void>
}
type Events = {
  console: Message
  dialog: Dialog
  domcontentloaded: void
  pageerror: unknown
  error: Error
  request: PageRequest
  requestfailed: PageRequest
}
export type Page = {
  on<Event extends keyof Events>(
    event: Event,
    hear: (value: Events[Event]) => void,
  ): unknown
  setViewport(view: {
    width: number
    height: number
    isMobile?: boolean
    hasTouch?: boolean
  }): Promise<void>
  emulateMediaFeatures(
    features: { name: string; value: string }[],
  ): Promise<void>
  setCookie(...cookies: Cookie[]): Promise<void>
  setRequestInterception(on: boolean): Promise<void>
  goto(url: string, options: {
    waitUntil: 'domcontentloaded'
    timeout: number
  }): Promise<{ status(): number } | null>
  createCDPSession(): Promise<Session>
  browser(): {
    targets(): { type(): string; createCDPSession(): Promise<Session> }[]
  }
  browserContext(): {
    overridePermissions(origin: string, permissions: string[]): Promise<void>
  }
  screenshot(options: {
    type: 'png'
    encoding: 'base64'
    optimizeForSpeed?: boolean
  }): Promise<string>
  mainFrame(): unknown
  bringToFront(): Promise<void>
  waitForSelector(
    selector: string,
    options: { timeout: number; visible: true; signal?: AbortSignal },
  ): Promise<Element | null>
  keyboard: {
    sendCharacter(text: string): Promise<void>
    press(key: string): Promise<void>
    down(key: string): Promise<void>
    up(key: string): Promise<void>
  }
  mouse: {
    down(): Promise<void>
    up(): Promise<void>
  }
  touchscreen: {
    touchStart(x: number, y: number): Promise<void>
    touchMove(x: number, y: number): Promise<void>
    touchEnd(): Promise<void>
  }
}
/** An element a step found on the page. */
export type Element = {
  tap(): Promise<void>
  hover(): Promise<void>
  focus(): Promise<void>
}
export type Session = {
  // deno-lint-ignore no-explicit-any
  send(method: any, params?: Record<string, unknown>): Promise<any>
  // deno-lint-ignore no-explicit-any
  on(event: any, hear: (said: any) => void): unknown
}
/**
 * A browser to open, acquired as a session and then connected to, and the
 * audit's script to run in its page.
 */
export type Browsing = Sessions<Browser> & { axe: Axe }
export type Browser = {
  newPage(): Promise<Page>
}

/** A rendered page, and the browser time it took. */
export type Rendered = {
  image: string
  /** The screenshots its `shot` steps took, in order. */
  shots: { name: string; image: string }[]
  /** The page's visible text, its start and end within `TEXT` characters. */
  text: string
  console: { type: string; text: string }[]
  /** What each `eval` step came to, in order, as JSON or the error it
   * threw. */
  evaluated?: string[]
  /** The dialogs the page opened, each dismissed as it opened: a confirm
   * answers false and a prompt null. */
  dialogs: { type: string; message: string }[]
  errors: string[]
  status: number
  /** The accessibility check, unless the visit asked for none. */
  accessibility?: Checked
  /** How long the page took to load, and each move a step made in place
   * (`TIMELINE`). */
  timings?: Timing[]
  /** How the page fits its window's width, with the accessibility check. */
  fit?: Fit
  duration: number
}
/** One load or move on the page, in milliseconds: `load` is the document's
 * first, from asking to its content loaded; `yak-page` a move between
 * pages in place (@yaks/web/navigate), from the click to the frame that
 * drew it, and `yak-press` from such a click to the frame that first showed
 * it; `fetched` the server's time on every page the navigator fetched;
 * `frame` a long animation frame: its `render` and `layout` at its end, and
 * its longest scripts, each with the style and layout it forced. `parts`
 * says where the time went, `server` what the answer's `Server-Timing` said.
 * They come in the order they happened. */
export type Timing = {
  name: string
  url: string
  ms: number
  parts: Record<string, number | string>
  server: Record<string, number>
}

// The page's own timeline, read in the audit's world: the document's load,
// every `yak-page` measure, each with the server's word on its answer, and
// each long frame (a `frame`), saying how much of it was style and layout and
// which scripts held it, with the style and layout each forced. Written as
// the script it runs, since a bundler's helpers would not come along with a
// function's own text.
let TIMELINE = `(async () => {
  let round = (n) => Math.round(n * 10) / 10
  let server = (url) => {
    let last = performance.getEntriesByName(url)
      .findLast((e) => e.serverTiming?.length)
    return Object.fromEntries(
      (last?.serverTiming ?? []).map((t) => [t.name, round(t.duration)]))
  }
  let kb = (n) => round(n / 1024)
  let out = []
  let load = performance.getEntriesByType('navigation')[0]
  let paint = performance.getEntriesByName('first-contentful-paint')[0]
  if (load) out.push({
    name: 'load',
    url: load.name,
    ms: round(load.domContentLoadedEventEnd),
    parts: {
      dns: round(load.domainLookupEnd - load.domainLookupStart),
      connect: round(load.connectEnd - load.connectStart),
      wait: round(load.responseStart - load.requestStart),
      read: round(load.responseEnd - load.responseStart),
      kb: kb(load.encodedBodySize),
      build: round(load.domContentLoadedEventEnd - load.responseEnd),
      ...load.activationStart ? { activation: round(load.activationStart) } : {},
      ...paint ? { paint: round(paint.startTime) } : {},
    },
    server: server(load.name),
  })
  // What the page fetched to draw and run, by kind: how many files, their
  // bytes over the wire, how many held the first paint, and when the last
  // of them arrived.
  let kinds = { css: /[.]css$/, js: /[.]m?js$/, font: /[.](woff2?|ttf|otf)$/ }
  let files = performance.getEntriesByType('resource')
  for (let [kind, test] of Object.entries(kinds)) {
    let of = files.filter((e) => test.test(new URL(e.name).pathname))
    if (!of.length) continue
    out.push({
      name: kind,
      url: location.href,
      ms: round(Math.max(...of.map((e) => e.responseEnd))),
      parts: {
        files: of.length,
        kb: kb(of.reduce((n, e) => n + e.encodedBodySize, 0)),
        cached: of.filter((e) => e.transferSize == 0).length,
        blocking: of.filter((e) => e.renderBlockingStatus == 'blocking').length,
      },
      server: {},
    })
  }
  // As in the open report, both the mark and the first paint must have happened.
  let usable = performance.getEntriesByName('yak-usable')[0]
  let picture = performance.getEntriesByName('yak-picture-paint')[0]
  let fresh = performance.getEntriesByName('yak-open-server')[0]
  let firstPaint = (picture ?? paint)?.startTime ?? 0
  if (picture) out.push({
    name: 'picture',
    url: location.href,
    ms: round(picture.startTime),
    parts: fresh ? { wait: round(fresh.detail) } : {},
    server: {},
  })
  if (usable) out.push({
    name: 'usable',
    url: location.href,
    ms: round(Math.max(usable.startTime, firstPaint)),
    parts: {
      ...usable.detail,
      ...usable.startTime < firstPaint ? { ready: round(usable.startTime) } : {},
    },
    server: {},
  })
  // The pages the navigator fetched (its yak-fetch marks), how many of
  // them ahead, and the server's time on them all: the load its looking
  // ahead puts on the server.
  let asked = performance.getEntriesByName('yak-fetch')
  if (asked.length) {
    let fetches = performance.getEntriesByType('resource')
      .filter((e) => e.initiatorType == 'fetch')
    let took = (m) => {
      let e = fetches.find((e) =>
        e.name == m.detail.url && e.startTime >= m.startTime - 1
      )
      return e?.serverTiming?.find((t) => t.name == 'total')?.duration ?? 0
    }
    out.push({
      name: 'fetched',
      url: location.href,
      ms: round(asked.reduce((n, m) => n + took(m), 0)),
      parts: {
        pages: asked.length,
        ahead: asked.filter((m) => m.detail.ahead).length,
      },
      server: {},
    })
  }
  let moves = [
    ...performance.getEntriesByName('yak-press'),
    ...performance.getEntriesByName('yak-page'),
    ...performance.getEntriesByName('yak-interaction'),
  ].sort((a, b) => a.startTime - b.startTime)
  for (let m of moves) {
    let { url = '', elapsed = m.duration, ...parts } = m.detail ?? {}
    out.push({
      name: m.name,
      url: String(url),
      ms: round(elapsed),
      startTime: m.startTime,
      parts: Object.fromEntries(Object.entries(parts)
        .map(([k, v]) => [k, typeof v == 'number' ? round(v) : v])),
      server: server(String(url)),
    })
  }
  let frames = typeof PerformanceObserver == 'undefined' ||
      !PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')
    ? []
    : await new Promise((done) => {
      let seen = new PerformanceObserver((list) => done(list.getEntries()))
      seen.observe({ type: 'long-animation-frame', buffered: true })
      setTimeout(() => done([]), 200)
    })
  let file = (url) => url.split('/').pop().split('?')[0]
  for (let f of frames) {
    let end = f.startTime + f.duration
    let scripts = [...f.scripts]
      .sort((a, b) => b.duration - a.duration).slice(0, 4)
    out.push({
      name: 'frame',
      url: location.href,
      ms: round(f.duration),
      startTime: f.startTime,
      parts: {
        at: round(f.startTime),
        render: round(end - (f.renderStart || end)),
        layout: round(end - (f.styleAndLayoutStart || end)),
        ...Object.fromEntries(scripts.map((s, i) => [
          'script' + (i + 1),
          [
            s.invoker,
            (s.sourceFunctionName || '?') + '@' + file(s.sourceURL || '') +
            ':' + s.sourceCharPosition,
            round(s.duration) + 'ms',
            'forced ' + round(s.forcedStyleAndLayoutDuration) + 'ms',
          ].join(' '),
        ])),
      },
      server: {},
    })
  }
  return out.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
    .map(({ startTime, ...t }) => t)
})()`

/** A render that failed, and the browser time it held all the same. */
export type Fault = { failed: string; stack?: string; timeout?: boolean }
export type Failed = Fault & { duration: number; refusal?: string }
export type Reply = (Rendered | Failed) & { faults?: Fault[] }
export type Result = (Omit<Rendered, 'image' | 'shots'> | Failed) & {
  faults?: Fault[]
}
export type BrowseFrame =
  | { kind: 'reset' }
  | { kind: 'progress'; stage: string; ms: number }
  | { kind: 'shot'; name: string }
  | { kind: 'result'; result: Result }

let failure = (e: unknown): Fault => ({
  failed: e instanceof Error ? e.message : String(e),
  stack: e instanceof Error ? e.stack : undefined,
  timeout: e instanceof BrowserTimeout || undefined,
})

let message = (error: unknown) => {
  if (!(error instanceof Error)) return String(error).slice(0, 2000)
  let { message, stack } = error
  // Puppeteer can rewrite a protocol error's message after capturing the stack.
  return (stack?.includes(message)
    ? stack
    : [message, stack].filter(Boolean).join('\n'))
    .slice(0, 2000)
}

// What `expression` came to in the page's own world, as JSON, or the error
// it threw.
let evaluate = async (page: Page, expression: string) => {
  let cdp = await page.createCDPSession()
  let { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (exceptionDetails) {
    return `error: ${
      exceptionDetails.exception?.description?.split('\n')[0] ??
        exceptionDetails.text
    }`
  }
  return JSON.stringify(result.value) ?? 'undefined'
}

// The audit runs in its own JavaScript world over the page's DOM, so what a
// page adds to its globals and prototypes never reaches axe-core.
let isolated = async (page: Page) => {
  let cdp = await page.createCDPSession()
  let { frameTree } = await cdp.send('Page.getFrameTree')
  let { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: 'audit',
  })
  return {
    evaluate: async (expression: string) => {
      let { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression,
        contextId: executionContextId,
        awaitPromise: true,
        returnByValue: true,
      })
      if (exceptionDetails) {
        throw new Error(
          exceptionDetails.exception?.description ?? exceptionDetails.text,
        )
      }
      return result.value
    },
  }
}

export let RENDER = 15_000
export let CHECK = 10_000
export let READ = 2_500
// A step's time. Cloudflare's browser has no GPU, so a WebGL page draws each
// frame in software, and every DevTools command a tap sends waits for one:
// a tap on a 3D game took 2.6 to 4.4 s there.
export let STEP = 4_000
// The most a visit's work may take: the load and capture, and six steps (an
// app_preview's most).
export let MOST = RENDER + 6 * STEP
// Allow time for the service binding and serialization outside the visit.
export let BROWSE_REPLY = OPEN + MOST + READ + RELEASE + 2_500

let stepWait = (step: Step) => 'wait' in step ? Math.max(0, step.wait) : 0

export let waiting = (
  { view, steps = [] }: Pick<Visit, 'view' | 'steps'>,
): number =>
  Math.max(0, view.wait) + steps.reduce((ms, step) => ms + stepWait(step), 0)

/** How long a visit's load, steps and screenshots may take, its planned
 * waits aside. */
export let allowed = ({ steps = [] }: Pick<Visit, 'steps'>): number =>
  Math.min(
    MOST,
    RENDER + steps.length * STEP +
      steps.filter((s) => 'open' in s).length * LOAD,
  )

/** The time a visit's planned waits get of their own, after the page loads
 * and between its steps, beside the time {@link allowed} its work. */
export let waitRoom = (visit: Pick<Visit, 'view' | 'steps'>): number =>
  Math.min(MOST, waiting(visit))

/** How long a visit may take in the browser: its work and its waits. */
export let visitTime = (visit: Pick<Visit, 'view' | 'steps'>): number =>
  allowed(visit) + waitRoom(visit)

/** Render time reserved for a preview, including its accessibility check. */
export let previewTime = (visit: Visit) => visitTime(visit) + CHECK

/** Allow time for the binding, opening a browser, and cleanup too. */
export let previewReply = (visit: Visit) =>
  OPEN + previewTime(visit) + RELEASE + 2_500

// How long a push waits for DevTools to name the site's service workers.
let REGISTERED = 2_000

// How long a step waits for the element it names to appear.
export let FIND = 5_000
let LOAD = 10_000

let waitExpired = (message: string) =>
  new CallError('browser_wait_expired', message)

let pause = (
  ms: number,
  stage: string,
  left: number,
  signal: AbortSignal,
  time: Clock,
) => {
  if (ms >= left) {
    throw waitExpired(
      `${stage} asks to wait ${ms} ms, which exceeds the remaining browser visit time. Shorten the wait or split the visit.`,
    )
  }
  return sleep(ms, signal, time)
}

let said = (step: Step) => JSON.stringify(step).slice(0, 200)

// Hover moves the mouse to the element's visible point. Chrome receives its
// reply before the press, and the press before release. Sending all three
// together can close a Cloudflare browser's connection on link navigation.
let click = async (page: Page, el: Element, signal: AbortSignal) => {
  await el.hover()
  signal.throwIfAborted()
  await page.mouse.down()
  signal.throwIfAborted()
  await page.mouse.up()
}

// One step, on a page laid out at `view`. A finger's swipe moves in ten
// stages so a page's touchmove handlers see it travel.
let taken = async (
  page: Page,
  view: View,
  step: Step,
  find: (selector: string, action: string) => Promise<Element>,
  signal: AbortSignal,
) => {
  // A link can open a foreground tab. Keep acting on the visit's original
  // tab, where Puppeteer's viewport observer and input need it visible.
  await page.bringToFront()
  signal.throwIfAborted()
  if ('tap' in step) {
    let el = await find(step.tap, view.touch ? 'tapping' : 'clicking')
    signal.throwIfAborted()
    return view.touch ? el.tap() : click(page, el, signal)
  }
  if ('hover' in step) {
    let el = await find(step.hover, 'hovering over')
    signal.throwIfAborted()
    return el.hover()
  }
  if ('type' in step) {
    if (step.into) {
      let el = await find(step.into, 'typing into')
      signal.throwIfAborted()
      await el.focus()
      signal.throwIfAborted()
    }
    // Insert text in one browser command. Individual keys use the press step.
    if (step.type) await page.keyboard.sendCharacter(step.type)
    return
  }
  if ('clear' in step) {
    let el = await find(step.clear, 'clearing')
    signal.throwIfAborted()
    await el.focus()
    signal.throwIfAborted()
    await page.keyboard.down('Control')
    signal.throwIfAborted()
    await page.keyboard.press('a')
    signal.throwIfAborted()
    await page.keyboard.up('Control')
    signal.throwIfAborted()
    return page.keyboard.press('Backspace')
  }
  if ('press' in step) return page.keyboard.press(step.press)
  if ('swipe' in step) {
    let [x1, y1, x2, y2] = step.swipe
    await page.touchscreen.touchStart(x1, y1)
    for (let i = 1; i <= 10; i++) {
      signal.throwIfAborted()
      await page.touchscreen.touchMove(
        x1 + (x2 - x1) * i / 10,
        y1 + (y2 - y1) * i / 10,
      )
    }
    signal.throwIfAborted()
    return page.touchscreen.touchEnd()
  }
  if ('keyboard' in step) return page.setViewport(viewport(view, step.keyboard))
  throw new Error(`no such step: ${said(step)}`)
}

// The first element a selector names that shows: what a person sees to tap,
// where a hidden one earlier in the page would take the press.
let missing = (step: string, selector: string) =>
  waitExpired(`${step} waited for a visible element matching ${selector}.`)

let shown = async (
  page: Page,
  selector: string,
  step: string,
  signal: AbortSignal,
) => {
  try {
    let el = await page.waitForSelector(selector, {
      timeout: FIND,
      visible: true,
      signal,
    })
    if (!el) throw missing(step, selector)
    return el
  } catch (e) {
    // Puppeteer's WaitTask deadline, which waitForSelector wraps with context.
    if (
      e instanceof Error &&
      e.message.includes(`Waiting failed: ${FIND}ms exceeded`)
    ) {
      throw missing(step, selector)
    }
    throw e
  }
}

// A slower phone's processor and network, and a first open's empty cache,
// set through the page's DevTools session before it loads.
let throttled = async (page: Page, view: View, url: string) => {
  if (!view.cpu && !view.network && !view.cold) return
  let cdp = await page.createCDPSession()
  if (view.cold) {
    await cdp.send('Network.clearBrowserCache')
    await cdp.send('Storage.clearDataForOrigin', {
      origin: new URL(url).origin,
      storageTypes: 'cache_storage,indexeddb,service_workers,local_storage',
    })
  }
  if (view.cpu) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: view.cpu })
  }
  let net = view.network && NETWORKS[view.network]
  if (net) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: net.latency,
      downloadThroughput: net.down,
      uploadThroughput: net.up,
    })
  }
}

// The page's network, and its service workers', which DevTools sets apart.
let network = async (page: Page, view: View, offline: boolean) => {
  let net = view.network && NETWORKS[view.network]
  let workers = page.browser().targets()
    .filter((t) => t.type() == 'service_worker')
  for (let cdp of [page, ...workers].map((t) => t.createCDPSession())) {
    let session = await cdp
    await session.send('Network.enable')
    await session.send('Network.emulateNetworkConditions', {
      offline,
      latency: net ? net.latency : 0,
      downloadThroughput: net ? net.down : -1,
      uploadThroughput: net ? net.up : -1,
    })
  }
}

// A message pushed to every service worker of the page's site, as its push
// service would deliver it.
let push = async (page: Page, origin: string, said: unknown) => {
  let cdp = await page.createCDPSession()
  let ids = new Set<string>()
  // DevTools names the registrations once it has answered being enabled.
  let named = Promise.withResolvers<void>()
  let none = setTimeout(named.resolve, REGISTERED)
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    for (let r of registrations) {
      if (!r.isDeleted && new URL(r.scopeURL).origin == origin) {
        ids.add(r.registrationId)
        named.resolve()
      }
    }
  })
  await cdp.send('ServiceWorker.enable')
  await named.promise
  clearTimeout(none)
  if (!ids.size) {
    throw new CallError(
      'browser_no_service_worker',
      `No service worker is registered at ${origin} to push to: open a page that registers one, and wait for it, before the push step.`,
    )
  }
  for (let registrationId of ids) {
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId,
      data: JSON.stringify(said),
    })
  }
}

let viewport = (view: View, keyboard = 0) => ({
  width: view.width,
  height: Math.max(1, view.height - Math.max(0, keyboard)),
  ...view.touch ? { isMobile: true, hasTouch: true } : {},
})

/** How much of a page's visible text a render carries. */
export let TEXT = 6000

// Like TIMELINE, this is sent to the page as source. Keep the first third
// and last two thirds so a long chat or feed includes its newest lines.
let PAGE_TEXT = `(() => {
  let text = document.body?.innerText ?? ''
  let most = ${TEXT}
  if (text.length <= most) return text
  let head = Math.floor(most / 3)
  return text.slice(0, head) + '\\n… ' + (text.length - most) +
    ' characters left out …\\n' + text.slice(head - most)
})()`

// The preview keeps its screenshot, console and errors if the check cannot
// finish. Read visible text in the same isolated world as the audit; a visit
// that asks for no audit still reads visible text and timings.
let checked = async (
  page: Page,
  axe: Axe | null,
  time: Clock,
  report: (error: unknown) => void,
): Promise<
  { accessibility?: Checked; fit?: Fit; text: string; timings?: Timing[] }
> => {
  try {
    return await bounded(
      time,
      axe ? CHECK : READ,
      () => axe ? 'Accessibility check' : "Reading the page's text",
      async (signal) => {
        let world = await isolated(page)
        signal.throwIfAborted()
        let accessibility = axe ? await audit(world, axe) : undefined
        signal.throwIfAborted()
        let measured = axe
          ? await world.evaluate(`${FIT}(document, window)`) as Fit
          : undefined
        signal.throwIfAborted()
        let text = String(await world.evaluate(PAGE_TEXT))
        let timings = await world.evaluate(TIMELINE) as Timing[]
        return {
          ...accessibility ? { accessibility } : {},
          ...measured ? { fit: measured } : {},
          text,
          timings,
        }
      },
    )
  } catch (e) {
    if (!axe) {
      report(e)
      return { text: '' }
    }
    let interrupted = interruption(e)
    return {
      accessibility: interrupted ? { interrupted } : { failed: message(e) },
      text: '',
    }
  }
}

type Loaded =
  & Omit<Rendered, 'duration' | 'accessibility' | 'fit' | 'text' | 'timings'>
  & {
    page: Page
    traced?: Timing[]
  }

class BrowserClosed extends Error {
  constructor(stage: string, cause: unknown) {
    super(`The browser session closed while ${stage}`, { cause })
  }
}

let closed = (e: unknown) => interruption(e) == 'target'

// A click can return while the destination is still loading. Wait for the
// document the browser started to load before reading or acting on it.
let navigating = (page: Page) => {
  let request: PageRequest | undefined
  let pending: PromiseWithResolvers<void> | undefined
  let arrived = () => {
    pending?.resolve()
    pending = undefined
    request = undefined
  }
  page.on('request', (asked) => {
    if (asked.isNavigationRequest() && asked.frame() === page.mainFrame()) {
      request = asked
      pending ??= Promise.withResolvers<void>()
    }
  })
  page.on('domcontentloaded', arrived)
  page.on('requestfailed', (failed) => {
    if (failed === request) arrived()
  })
  return () => pending?.promise
}

// The page's first load answered with `html`, and every other request let
// through to the site. Interception holds each request until it is answered,
// so every one is.
let answered = async (
  page: Page,
  html: string,
  error: (e: unknown) => void,
) => {
  let pending = true
  page.on('request', (asked) => {
    let first = pending && asked.isNavigationRequest() &&
      asked.frame() === page.mainFrame()
    if (first) pending = false
    let went = first
      ? asked.respond({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: html,
      })
      : asked.continue()
    went.catch(error)
  })
  await page.setRequestInterception(true)
}

let loaded = async (
  browser: Browser,
  { url, view, cookies = [], steps = [], allow = [], audit, html }: Visit,
  ms: number,
  time: Clock,
  screens?: Screens,
  files?: MockupAssets,
): Promise<Loaded> => {
  let stage = 'opening the page'
  let waitingFor = (next: string) => {
    stage = next
    screens?.progress(next)
  }
  waitingFor(stage)
  let finding: { step: string; selector: string } | undefined
  let deadline = time.now() + ms
  let loading = bounded(
    time,
    ms,
    () => `Browser visit while ${stage}`,
    async (signal) => {
      let page = await browser.newPage()
      let console: Rendered['console'] = []
      let dialogs: Rendered['dialogs'] = []
      let errors: string[] = []
      let error = (e: unknown) => {
        if (errors.length < 100) errors.push(message(e))
      }
      page.on('console', (m) => {
        if (console.length < 100 && !edge(m)) {
          console.push({ type: m.type(), text: m.text().slice(0, 2000) })
        }
      })
      page.on('dialog', (d) => {
        if (dialogs.length < 100) {
          dialogs.push({ type: d.type(), message: d.message().slice(0, 2000) })
        }
        d.dismiss().catch(error)
      })
      page.on('pageerror', error)
      page.on('error', error)
      signal.throwIfAborted()
      await page.setViewport(viewport(view))
      signal.throwIfAborted()
      await throttled(page, view, url)
      signal.throwIfAborted()
      if (view.dark) {
        await page.emulateMediaFeatures([
          { name: 'prefers-color-scheme', value: 'dark' },
        ])
      }
      signal.throwIfAborted()
      if (!files && cookies.length) await page.setCookie(...cookies)
      signal.throwIfAborted()
      if (allow.length) {
        await page.browserContext().overridePermissions(
          new URL(url).origin,
          allow,
        )
      }
      signal.throwIfAborted()
      if (files) await serveMockup(page, files, error)
      else if (html != null) await answered(page, html, error)
      signal.throwIfAborted()
      waitingFor('waiting for the page to reach DOMContentLoaded')
      let status = 0
      try {
        status = (await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: LOAD,
        }))?.status() ?? 0
      } catch (e) {
        if (closed(e)) throw e
        if (
          audit === false && e instanceof Error &&
          e.message === `Navigation timeout of ${LOAD} ms exceeded`
        ) {
          throw waitExpired(
            `The page did not reach DOMContentLoaded within ${
              LOAD / 1000
            } seconds.`,
          )
        }
        error(e)
      }
      signal.throwIfAborted()
      let navigation: ReturnType<typeof navigating> | undefined
      let ready = async () => {
        let loading = navigation?.()
        if (!loading) return
        waitingFor('waiting for DOMContentLoaded after navigation')
        await loading
        signal.throwIfAborted()
      }
      if (view.wait) {
        waitingFor(`waiting ${view.wait} ms after the page loaded`)
        await pause(
          view.wait,
          'The post-load wait',
          deadline - time.now(),
          signal,
          time,
        )
      }
      let shots: Rendered['shots'] = []
      let evaluated: string[] = []
      let shoot = () =>
        page.screenshot({
          type: 'png',
          encoding: 'base64',
          optimizeForSpeed: audit === false,
        })
      let traced = view.trace
        ? await tracing(await page.createCDPSession())
        : undefined
      for (let [i, step] of steps.entries()) {
        signal.throwIfAborted()
        if (!('wait' in step)) await ready()
        let at = `Step ${i + 1}`
        waitingFor(`taking step ${i + 1}`)
        if ('wait' in step) {
          waitingFor(`${stage} (waiting ${step.wait} ms)`)
          await pause(step.wait, at, deadline - time.now(), signal, time)
          continue
        }
        if ('open' in step) {
          waitingFor(`opening ${step.open}`)
          status = (await page.goto(new URL(step.open, url).href, {
            waitUntil: 'domcontentloaded',
            timeout: LOAD,
          }))?.status() ?? 0
          continue
        }
        if ('push' in step) {
          waitingFor('pushing a message')
          await push(page, new URL(url).origin, step.push)
          continue
        }
        if ('offline' in step) {
          await network(page, view, step.offline)
          continue
        }
        if ('eval' in step) {
          waitingFor(`taking step ${i + 1} (evaluating)`)
          evaluated.push(await evaluate(page, step.eval))
          continue
        }
        if ('shot' in step) {
          waitingFor(`${stage} (taking a screenshot)`)
          let image = await shoot()
          signal.throwIfAborted()
          waitingFor(`sending the screenshot for step ${i + 1}`)
          if (screens) await screens.shot(step.shot, image)
          else shots.push({ name: step.shot, image })
          continue
        }
        navigation ??= navigating(page)
        try {
          await taken(page, view, step, async (selector, action) => {
            waitingFor(`taking step ${i + 1} (waiting for a visible element)`)
            finding = { step: at, selector }
            let el = await shown(page, selector, at, signal)
            finding = undefined
            waitingFor(`taking step ${i + 1} (${action} the element)`)
            return el
          }, signal)
        } catch (e) {
          if (!signal.aborted) finding = undefined
          if (e instanceof CallError || closed(e)) throw e
          error(new Error(`step ${i + 1} ${said(step)}: ${message(e)}`))
          break
        }
      }
      signal.throwIfAborted()
      await ready()
      waitingFor('reading the trace')
      let trace = await traced?.()
      signal.throwIfAborted()
      waitingFor('taking the final screenshot')
      let image = await shoot()
      signal.throwIfAborted()
      waitingFor('sending the final screenshot')
      if (screens) await screens.shot('end', image)
      return {
        page,
        image: screens ? '' : image,
        shots,
        console,
        dialogs,
        errors,
        status,
        ...evaluated.length ? { evaluated } : {},
        ...trace
          ? {
            traced: [
              {
                name: 'trace',
                url,
                ms: 0,
                parts: {
                  events: trace.events,
                  marked: String(trace.marked),
                  tasks: trace.tasks.length,
                },
                server: {},
              },
              ...trace.tasks.map((t) => ({
                name: 'task',
                url,
                ms: t.ms,
                parts: {
                  at: t.at,
                  ...Object.fromEntries(t.spent),
                  styled: t.styled,
                  laid: t.laid,
                },
                server: {},
              })),
            ],
          }
          : {},
      }
    },
  )
  try {
    return await loading
  } catch (e) {
    if (finding && e instanceof BrowserTimeout) {
      throw missing(finding.step, finding.selector)
    }
    throw closed(e) ? new BrowserClosed(stage, e) : e
  }
}

export let capture = async (
  browsing: Browsing,
  visit: Visit,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  time: Clock = system,
  {
    hold = () => {},
    report = () => {},
    screens,
    files,
  }: Partial<SessionOptions> & { screens?: Screens; files?: MockupAssets } = {},
): Promise<Rendered> => {
  let start = time.now()
  let opening = start + OPEN
  let render = visitTime(visit)
  let end = opening + render
  let left = () => end - time.now()
  let attempt = (openBy: number) =>
    withSession(browsing, openBy, time, {
      hold,
      report,
      progress: screens?.progress,
    }, async (browser) => {
      await screens?.reset()
      let { page, traced = [], ...shot } = await loaded(
        browser,
        visit,
        Math.min(render, left()),
        time,
        screens,
        files,
      )
      screens?.progress("reading the page's text and timings")
      let read = await checked(
        page,
        visit.audit === false ? null : browsing.axe,
        time,
        (e) => {
          report(e)
          if (shot.errors.length < 100) shot.errors.push(message(e))
        },
      )
      return {
        ...shot,
        ...read,
        ...traced.length ? { timings: [...read.timings ?? [], ...traced] } : {},
      }
    })
  let result: Omit<Rendered, 'duration'>
  let duration: number
  try {
    try {
      result = await attempt(opening)
    } catch (e) {
      if (
        !(e instanceof BrowserClosed) || left() <= CONNECT ||
        visit.steps?.some((step) => !('wait' in step || 'shot' in step))
      ) throw e
      report(e)
      result = await attempt(end)
    }
  } finally {
    duration = Math.max(0, time.now() - start)
    await used(duration)
  }
  return { ...result, duration }
}

let documentTooLarge = () =>
  new CallError(
    'html_too_large',
    `a page's document runs to ${
      HTML_LIMIT / 1_000_000
    } million characters at most`,
  )

let visitIn = async (
  req: Request,
): Promise<{ visit: Visit; files?: MockupAssets }> => {
  if (req.headers.get('content-type') != WIRE) {
    return { visit: await req.json() }
  }
  let file = await readAsk<BrowseVisit>(req.body)
  try {
    let { mockup, ...visit } = file.head
    if (mockup != null) {
      let files = await mockupAssets(mockup, file.size ?? 0, file.body)
      let path = mockupPath(visit.url)
      if (!path || !files.has(path)) {
        throw new CallError(
          'mockup_page',
          'Choose a page in the mockup directory.',
        )
      }
      return { visit, files }
    }
    if ((file.size ?? 0) > HTML_BYTES) throw documentTooLarge()
    if (!file.body) return { visit }
    // Puppeteer's intercepted response requires the document as one string.
    let held = await holding({ stream: file.body }, HTML_BYTES)
    if (!(held instanceof Uint8Array)) {
      await held.stream.cancel()
      throw documentTooLarge()
    }
    let html = new TextDecoder('utf-8', { ignoreBOM: true }).decode(held)
    if (html.length > HTML_LIMIT) throw documentTooLarge()
    return { visit: { ...visit, html } }
  } finally {
    await file.close()
  }
}

let run = async (
  req: Request,
  browsing: Browsing,
  time: Clock,
  hold?: Hold,
  screens?: Screens,
): Promise<Reply> => {
  let duration = 0
  let faults: Fault[] = []
  let report = (e: unknown) => faults.push(failure(e))
  let result: Rendered | Failed
  try {
    let { visit, files } = await visitIn(req)
    result = await capture(
      browsing,
      visit,
      (ms) => {
        duration = ms
        return Promise.resolve()
      },
      time,
      { hold, report, screens, files },
    )
  } catch (e) {
    result = e instanceof CallError
      ? { failed: e.message, refusal: e.code, duration }
      : { ...failure(e), duration }
  }
  return { ...result, ...faults.length ? { faults } : {} }
}

/** The browser service's reply carries elapsed time on both paths. */
export let answer = (
  browsing: Browsing,
  time: Clock = system,
  hold?: Hold,
): (req: Request) => Promise<Response> =>
async (req: Request): Promise<Response> => {
  if (req.headers.get('accept') == WIRE) {
    return streamBrowse(
      req.headers.get(PROGRESS) == '1',
      time,
      async (screens) => {
        let said = await run(req, browsing, time, hold, screens)
        if ('failed' in said) return said
        let { image: _image, shots: _shots, ...result } = said
        return result
      },
    )
  }
  let result = await run(req, browsing, time, hold)
  let status = !('failed' in result)
    ? 200
    : result.refusal == 'html_too_large'
    ? 413
    : result.refusal
    ? 400
    : result.timeout
    ? 504
    : 500
  return Response.json(result, { status })
}
