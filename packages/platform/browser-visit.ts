// What yak-browser does with a request: a page's address, viewport, the
// cookies it is opened with and the steps a person takes on it posted in, its
// screenshots, text, console, dialogs, errors, status and accessibility check
// out, with the browser time it held. Browser control runs on Cloudflare; the small
// session interface lets the load, steps, diagnostics and cleanup run in
// process without a local browser.
import { type Clock, type Hold, sleep, system } from '@yaks/fp'
import { CallError } from '@yaks/tools/errors'
import { audit, type Axe, type Checked, interruption } from './preview-audit.ts'
import { bounded, BrowserTimeout } from './browser-time.ts'

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

/** A window: its size, how long to wait after loading, and whether it is a
 * phone's (touch events, a mobile viewport). */
export type View = {
  width: number
  height: number
  wait: number
  touch?: boolean
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
}
export type Message = { type(): string; text(): string }
/** An alert, confirm, prompt or beforeunload dialog the page opened. Input
 * waits while one is open, so a step that opens one would never return. */
export type Dialog = {
  type(): string
  message(): string
  dismiss(): Promise<void>
}
type Events = {
  console: Message
  dialog: Dialog
  pageerror: unknown
  error: Error
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
  setCookie(...cookies: Cookie[]): Promise<void>
  goto(url: string, options: {
    waitUntil: 'domcontentloaded'
    timeout: number
  }): Promise<{ status(): number } | null>
  createCDPSession(): Promise<Session>
  browserContext(): {
    overridePermissions(origin: string, permissions: string[]): Promise<void>
  }
  screenshot(options: { type: 'png'; encoding: 'base64' }): Promise<string>
  bringToFront(): Promise<void>
  waitForSelector(
    selector: string,
    options: { timeout: number; visible: true; signal?: AbortSignal },
  ): Promise<Element | null>
  keyboard: {
    type(text: string): Promise<void>
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
  type(text: string): Promise<void>
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
  /** The page's visible text, as far as `TEXT` characters. */
  text: string
  console: { type: string; text: string }[]
  /** The dialogs the page opened, each dismissed as it opened: a confirm
   * answers false and a prompt null. */
  dialogs: { type: string; message: string }[]
  errors: string[]
  status: number
  /** The accessibility check, unless the visit asked for none. */
  accessibility?: Checked
  duration: number
}
/** A render that failed, and the browser time it held all the same. */
export type Fault = { failed: string; stack?: string; timeout?: boolean }
export type Failed = Fault & { duration: number; refusal?: string }
export type Reply = (Rendered | Failed) & { faults?: Fault[] }

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
export let allowed = ({ steps = [] }: Pick<Visit, 'steps'>): number =>
  Math.min(
    MOST,
    RENDER + steps.reduce(
      (ms, s) => ms + STEP + stepWait(s),
      0,
    ),
  )

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
    if (!step.into) return page.keyboard.type(step.type)
    let el = await find(step.into, 'typing into')
    signal.throwIfAborted()
    return el.type(step.type)
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

// The preview keeps its screenshot, console and errors if the check cannot
// finish. Read visible text in the same isolated world as the audit; a visit
// that asks for no audit reads only its text.
let checked = async (
  page: Page,
  axe: Axe | null,
  time: Clock,
  report: (error: unknown) => void,
): Promise<{ accessibility?: Checked; text: string }> => {
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
        let text = String(
          await world.evaluate(
            `(document.body?.innerText ?? '').slice(0, ${TEXT})`,
          ),
        )
        return { ...accessibility ? { accessibility } : {}, text }
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

type Loaded = Omit<Rendered, 'duration' | 'accessibility' | 'text'> & {
  page: Page
}

class BrowserClosed extends Error {
  constructor(stage: string, cause: unknown) {
    super(`The browser session closed while ${stage}`, { cause })
  }
}

let closed = (e: unknown) => interruption(e) == 'target'

let loaded = async (
  browser: Browser,
  { url, view, cookies = [], steps = [], allow = [], audit }: Visit,
  ms: number,
  time: Clock,
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
      if (cookies.length) await page.setCookie(...cookies)
      signal.throwIfAborted()
      if (allow.length) {
        await page.browserContext().overridePermissions(
          new URL(url).origin,
          allow,
        )
      }
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
      let shoot = () => page.screenshot({ type: 'png', encoding: 'base64' })
      for (let [i, step] of steps.entries()) {
        signal.throwIfAborted()
        let at = `Step ${i + 1}`
        stage = `taking step ${i + 1}`
        if ('wait' in step) {
          stage += ` (waiting ${step.wait} ms)`
          await pause(step.wait, at, deadline - time.now(), signal, time)
          continue
        }
        if ('shot' in step) {
          stage += ' (taking a screenshot)'
          shots.push({ name: step.shot, image: await shoot() })
          continue
        }
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
      stage = 'taking the final screenshot'
      let image = await shoot()
      return { page, image, shots, console, dialogs, errors, status }
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
  { hold = () => {}, report = () => {} }: Partial<SessionOptions> = {},
): Promise<Rendered> => {
  let start = time.now()
  let opening = start + OPEN
  let render = allowed(visit)
  let end = opening + render
  let left = () => end - time.now()
  let attempt = (openBy: number) =>
    withSession(browsing, openBy, time, { hold, report }, async (browser) => {
      let { page, ...shot } = await loaded(
        browser,
        visit,
        Math.min(render, left()),
        time,
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

/** The browser service's reply carries elapsed time on both paths. */
export let answer = (
  browsing: Browsing,
  time: Clock = system,
  hold?: Hold,
): (req: Request) => Promise<Response> =>
async (req: Request): Promise<Response> => {
  let duration = 0
  let faults: Fault[] = []
  let report = (e: unknown) => faults.push(failure(e))
  let result: Rendered | Failed
  let status = 200
  try {
    result = await capture(
      browsing,
      await req.json() as Visit,
      (ms) => {
        duration = ms
        return Promise.resolve()
      },
      time,
      { hold, report },
    )
  } catch (e) {
    if (e instanceof CallError) {
      result = { failed: e.message, refusal: e.code, duration }
      status = 400
    } else {
      result = { ...failure(e), duration }
      status = result.timeout ? 504 : 500
    }
  }
  return Response.json({ ...result, ...faults.length ? { faults } : {} }, {
    status,
  })
}
