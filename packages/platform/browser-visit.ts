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
import {
  header,
  HTML_BYTES,
  HTML_LIMIT,
  readAsk,
  WIRE,
} from './browser-wire.ts'
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
 * the dark theme. */
export type View = {
  width: number
  height: number
  wait: number
  touch?: boolean
  dark?: boolean
}
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
 *   swipe     drag a finger from one point to another, [x1, y1, x2, y2]
 *   keyboard  a phone's on-screen keyboard opens over this many pixels: the
 *             window shrinks by them, as it does for a page that asks to be
 *             resized (`interactive-widget=resizes-content`); 0 closes it
 *   wait      wait this many milliseconds
 *   shot      take a screenshot, kept under this name
 */
export type Step =
  | { tap: string }
  | { type: string; into?: string }
  | { clear: string }
  | { press: string }
  | { swipe: [number, number, number, number] }
  | { keyboard: number }
  | { wait: number }
  | { shot: string }
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
export type Message = { type(): string; text(): string }
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
  /** The page's visible text, its start and end within `TEXT` characters
   * (`clip`). */
  text: string
  console: { type: string; text: string }[]
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
 * drew it. `parts` says where the time went, `server` what the answer's
 * `Server-Timing` said. */
export type Timing = {
  name: string
  url: string
  ms: number
  parts: Record<string, number | string>
  server: Record<string, number>
}

// The page's own timeline, read in the audit's world: the document's load
// and every `yak-page` measure, each with the server's word on its answer.
// Written as the script it runs, since a bundler's helpers would not come
// along with a function's own text.
let TIMELINE = `(() => {
  let round = (n) => Math.round(n * 10) / 10
  let server = (url) => {
    let last = performance.getEntriesByName(url)
      .findLast((e) => e.serverTiming?.length)
    return Object.fromEntries(
      (last?.serverTiming ?? []).map((t) => [t.name, round(t.duration)]))
  }
  let out = []
  let load = performance.getEntriesByType('navigation')[0]
  if (load) out.push({
    name: 'load',
    url: load.name,
    ms: round(load.domContentLoadedEventEnd),
    parts: {
      wait: round(load.responseStart - load.requestStart),
      read: round(load.responseEnd - load.responseStart),
      build: round(load.domContentLoadedEventEnd - load.responseEnd),
    },
    server: server(load.name),
  })
  for (let m of performance.getEntriesByName('yak-page')) {
    let { url = '', ...parts } = m.detail ?? {}
    out.push({
      name: m.name,
      url: String(url),
      ms: round(m.duration),
      parts: Object.fromEntries(Object.entries(parts)
        .map(([k, v]) => [k, typeof v == 'number' ? round(v) : v])),
      server: server(String(url)),
    })
  }
  return out
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
  | { kind: 'shot'; name: string }
  | { kind: 'result'; result: Result }
type Screens = {
  reset: () => Promise<void>
  shot: (name: string, image: string) => Promise<void>
}

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
export let MOST = 20_000
// Allow time for the service binding and serialization outside the visit.
export let BROWSE_REPLY = OPEN + MOST + READ + RELEASE + 2_500
export let PREVIEW_REPLY = OPEN + RENDER + CHECK + RELEASE + 2_500
export let STEP = 2_000

let stepWait = (step: Step) => 'wait' in step ? Math.max(0, step.wait) : 0

export let waiting = (
  { view, steps = [] }: Pick<Visit, 'view' | 'steps'>,
): number =>
  Math.max(0, view.wait) + steps.reduce((ms, step) => ms + stepWait(step), 0)

/** How long a visit's load, steps and screenshots may take. */
export let allowed = (
  { steps = [] }: Pick<Visit, 'steps'>,
  includeWaits = true,
): number =>
  Math.min(
    MOST,
    RENDER + steps.length * STEP +
      (includeWaits ? steps.reduce((ms, s) => ms + stepWait(s), 0) : 0),
  )

/** Planned waits get time of their own in an interactive browse visit. */
export let waitRoom = (visit: Visit): number =>
  visit.audit === false ? Math.min(MOST, waiting(visit)) : 0

// How long a step waits for the element it names to appear.
let FIND = 5_000
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

let viewport = (view: View, keyboard = 0) => ({
  width: view.width,
  height: Math.max(1, view.height - Math.max(0, keyboard)),
  ...view.touch ? { isMobile: true, hasTouch: true } : {},
})

/** How much of a page's visible text a render carries. */
export let TEXT = 6000

/**
 * A page's visible text cut to `most` characters: its first third and its
 * last two, which on a chat or a feed are the newest lines and what the
 * window shows, with how much between them was left out. Run in the page,
 * so it names nothing outside itself.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(clip('short', 10), 'short')
 * assertEquals(clip('abcdefghijklmnopqrstuvwxyz', 9), 'abc\n… 17 characters left out …\nuvwxyz')
 * ```
 */
export function clip(text: string, most: number): string {
  if (text.length <= most) return text
  let head = Math.floor(most / 3), tail = most - head
  return `${text.slice(0, head)}\n… ${
    text.length - most
  } characters left out …\n${text.slice(-tail)}`
}

// The preview keeps its screenshot, console and errors if the check cannot
// finish. Read visible text in the same isolated world as the audit; a visit
// that asks for no audit reads only its text.
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
        let text = String(
          await world.evaluate(
            `(${clip})(document.body?.innerText ?? '', ${TEXT})`,
          ),
        )
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
        if (console.length < 100) {
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
      stage = 'loading the page'
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
        stage = 'loading the page after navigation'
        await loading
        signal.throwIfAborted()
      }
      if (view.wait) {
        stage = 'waiting after the page loaded'
        await pause(
          view.wait,
          'The post-load wait',
          deadline - time.now(),
          signal,
          time,
        )
      }
      let shots: Rendered['shots'] = []
      let shoot = () =>
        page.screenshot({
          type: 'png',
          encoding: 'base64',
          optimizeForSpeed: audit === false,
        })
      for (let [i, step] of steps.entries()) {
        signal.throwIfAborted()
        if (!('wait' in step)) await ready()
        let at = `Step ${i + 1}`
        stage = `taking step ${i + 1}`
        if ('wait' in step) {
          stage += ` (waiting ${step.wait} ms)`
          await pause(step.wait, at, deadline - time.now(), signal, time)
          continue
        }
        if ('shot' in step) {
          stage += ' (taking a screenshot)'
          let image = await shoot()
          if (screens) await screens.shot(step.shot, image)
          else shots.push({ name: step.shot, image })
          continue
        }
        navigation ??= navigating(page)
        try {
          await taken(page, view, step, async (selector, action) => {
            stage = `taking step ${i + 1} (waiting for a visible element)`
            finding = { step: at, selector }
            let el = await shown(page, selector, at, signal)
            finding = undefined
            stage = `taking step ${i + 1} (${action} the element)`
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
      stage = 'taking the final screenshot'
      let image = await shoot()
      if (screens) await screens.shot('end', image)
      return {
        page,
        image: screens ? '' : image,
        shots,
        console,
        dialogs,
        errors,
        status,
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
  let render = allowed(visit, visit.audit !== false) + waitRoom(visit)
  let end = opening + render
  let left = () => end - time.now()
  let attempt = (openBy: number) =>
    withSession(browsing, openBy, time, { hold, report }, async (browser) => {
      await screens?.reset()
      let { page, ...shot } = await loaded(
        browser,
        visit,
        Math.min(render, left()),
        time,
        screens,
        files,
      )
      return {
        ...shot,
        ...await checked(
          page,
          visit.audit === false ? null : browsing.axe,
          time,
          (e) => {
            report(e)
            if (shot.errors.length < 100) shot.errors.push(message(e))
          },
        ),
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

let stream = (
  req: Request,
  browsing: Browsing,
  time: Clock,
  hold?: Hold,
) => {
  let { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  let write = writable.getWriter()
  let frame = (head: BrowseFrame, size?: number) =>
    write.write(header(head, size))
  let screens: Screens = {
    reset: () => frame({ kind: 'reset' }),
    shot: async (name, image) => {
      // CDP gives one base64 screenshot at a time. Decode it in bounded
      // pieces as the receiver takes the PNG.
      let padding = image.endsWith('==') ? 2 : image.endsWith('=') ? 1 : 0
      let size = Math.floor((image.length - padding) * 3 / 4)
      await frame({ kind: 'shot', name }, size)
      for (let at = 0; at < image.length; at += 64 * 1024) {
        await write.write(
          Uint8Array.fromBase64(image.slice(at, at + 64 * 1024)),
        )
      }
    },
  }
  let send = async () => {
    let said = await run(req, browsing, time, hold, screens)
    let result = 'failed' in said
      ? said
      : (({ image: _image, shots: _shots, ...result }) => result)(said)
    await frame({ kind: 'result', result })
    await write.close()
  }
  send().catch((e) => write.abort(e).catch(() => {}))
  return new Response(readable, { headers: { 'content-type': WIRE } })
}

/** The browser service's reply carries elapsed time on both paths. */
export let answer = (
  browsing: Browsing,
  time: Clock = system,
  hold?: Hold,
): (req: Request) => Promise<Response> =>
async (req: Request): Promise<Response> => {
  if (req.headers.get('accept') == WIRE) {
    return stream(req, browsing, time, hold)
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
