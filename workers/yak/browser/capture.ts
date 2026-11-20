// What yak-browser does with a request: a page's address, viewport, the
// cookies it is opened with and the steps a person takes on it posted in, its
// screenshots, text, console, errors, status and accessibility check out, with
// the browser time it held. Browser control runs on Cloudflare; the small
// session interface lets the load, steps, diagnostics and cleanup run in
// process without a local browser.
import { type Clock, sleep, system } from '@yaks/fp'
import {
  audit,
  type Axe,
  type Checked,
  interruption,
} from '@yaks/platform/preview-audit'

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
 *   tap       press the element a selector names (a touch on a phone's view)
 *   type      type text, into the element a selector names or what has focus
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
}
export type Message = { type(): string; text(): string }
type Events = { console: Message; pageerror: unknown; error: Error }
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
  screenshot(options: { type: 'png'; encoding: 'base64' }): Promise<string>
  waitForSelector(
    selector: string,
    options: { timeout: number },
  ): Promise<unknown>
  tap(selector: string): Promise<void>
  click(selector: string): Promise<void>
  type(selector: string, text: string): Promise<void>
  keyboard: {
    type(text: string): Promise<void>
    press(key: string): Promise<void>
  }
  touchscreen: {
    touchStart(x: number, y: number): Promise<void>
    touchMove(x: number, y: number): Promise<void>
    touchEnd(): Promise<void>
  }
}
export type Session = {
  // deno-lint-ignore no-explicit-any
  send(method: any, params?: Record<string, unknown>): Promise<any>
}
/**
 * A browser to open, acquired as a session and then connected to, and the
 * audit's script to run in its page.
 */
export type Browsing = {
  acquire: () => Promise<string>
  connect: (session: string) => Promise<Browser>
  axe: Axe
}
export type Browser = {
  newPage(): Promise<Page>
  close(): Promise<void>
}

/** A rendered page, and the browser time it took. */
export type Rendered = {
  image: string
  /** The screenshots its `shot` steps took, in order. */
  shots: { name: string; image: string }[]
  /** The page's visible text, as far as `TEXT` characters. */
  text: string
  console: { type: string; text: string }[]
  errors: string[]
  status: number
  accessibility: Checked
  duration: number
}
/** A render that failed, and the browser time it held all the same. */
export type Failed = { failed: string; stack?: string; duration: number }

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

let retried = async <T>(
  run: () => Promise<T>,
  pauses: number[],
  time: Clock,
  again: (error: unknown) => boolean = () => true,
): Promise<T> => {
  for (let pause of pauses) {
    try {
      return await run()
    } catch (e) {
      if (!again(e)) throw e
      await sleep(pause, undefined, time)
    }
  }
  return run()
}

let temporary = (error: unknown) =>
  error instanceof Error &&
  /^Unable to create new browser: code: 5\d\d:/.test(error.message)

// Capacity can return a temporary 503 before a session exists. Once acquired,
// a session may not take its websocket connection yet; retry that same session
// rather than allocating another browser.
let open = async (
  { acquire, connect }: Browsing,
  time: Clock,
): Promise<Browser> => {
  let session = await retried(acquire, [1000, 2000, 4000], time, temporary)
  return retried(() => connect(session), [250, 500, 1000], time)
}

// A deadline for one stage of a preview, failing with what ran out of time.
let deadline = (time: Clock, ms: number, said: string) => {
  let cancel = () => {}
  let timeout = new Promise<never>((_, reject) => {
    cancel = time.after(ms, () => reject(new Error(said)))
  })
  timeout.catch(() => {})
  return {
    bounded: <T>(work: Promise<T>) => Promise.race([work, timeout]),
    cancel,
  }
}

// The page's load and screenshot have fifteen seconds; the accessibility
// check then has ten of its own, so a slow load never leaves it the remainder.
export let RENDER = 15_000
export let CHECK = 10_000
// Each step a visit takes adds two seconds and its own wait to the load's,
// up to a minute in all.
export let STEP = 2_000
export let MOST = 60_000

/** How long a visit's load, steps and screenshots may take. */
export let allowed = ({ steps = [] }: Pick<Visit, 'steps'>) =>
  Math.min(
    MOST,
    RENDER + steps.reduce(
      (ms, s) => ms + STEP + ('wait' in s ? Math.max(0, s.wait) : 0),
      0,
    ),
  )

// How long a step waits for the element it names to appear.
let FIND = 5_000

let said = (step: Step) => JSON.stringify(step).slice(0, 200)

// One step, on a page laid out at `view`. A finger's swipe moves in ten
// stages so a page's touchmove handlers see it travel.
let taken = async (page: Page, view: View, step: Step, time: Clock) => {
  if ('tap' in step) {
    await page.waitForSelector(step.tap, { timeout: FIND })
    return view.touch ? page.tap(step.tap) : page.click(step.tap)
  }
  if ('type' in step) {
    if (!step.into) return page.keyboard.type(step.type)
    await page.waitForSelector(step.into, { timeout: FIND })
    return page.type(step.into, step.type)
  }
  if ('press' in step) return page.keyboard.press(step.press)
  if ('swipe' in step) {
    let [x1, y1, x2, y2] = step.swipe
    await page.touchscreen.touchStart(x1, y1)
    for (let i = 1; i <= 10; i++) {
      await page.touchscreen.touchMove(
        x1 + (x2 - x1) * i / 10,
        y1 + (y2 - y1) * i / 10,
      )
    }
    return page.touchscreen.touchEnd()
  }
  if ('keyboard' in step) return page.setViewport(viewport(view, step.keyboard))
  if ('wait' in step) return sleep(step.wait, undefined, time)
  throw new Error(`no such step: ${said(step)}`)
}

let viewport = (view: View, keyboard = 0) => ({
  width: view.width,
  height: Math.max(1, view.height - Math.max(0, keyboard)),
  ...view.touch ? { isMobile: true, hasTouch: true } : {},
})

/** How much of a page's visible text a render carries. */
export let TEXT = 6000

// The preview keeps its screenshot, console and errors if the check cannot
// finish. Read visible text in the same isolated world as the audit.
let checked = async (
  page: Page,
  axe: Axe,
  time: Clock,
): Promise<{ accessibility: Checked; text: string }> => {
  let { bounded, cancel } = deadline(
    time,
    CHECK,
    `Accessibility check timed out after ${CHECK / 1000} seconds`,
  )
  try {
    return await bounded(
      isolated(page).then(async (world) => ({
        accessibility: await audit(world, axe),
        text: String(
          await world.evaluate(
            `(document.body?.innerText ?? '').slice(0, ${TEXT})`,
          ),
        ),
      })),
    )
  } catch (e) {
    let interrupted = interruption(e)
    return {
      accessibility: interrupted ? { interrupted } : { failed: message(e) },
      text: '',
    }
  } finally {
    cancel()
  }
}

export let capture = async (
  browsing: Browsing,
  { url, view, cookies = [], steps = [] }: Visit,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  time: Clock = system,
): Promise<Rendered> => {
  let start = time.now()
  let browser = await open(browsing, time)
  let duration = 0
  let { bounded, cancel } = deadline(
    time,
    allowed({ steps }),
    'Browser preview timed out',
  )
  let result: Omit<Rendered, 'duration'>
  try {
    let loaded = await bounded((async () => {
      let page = await browser.newPage()
      let console: { type: string; text: string }[] = []
      let errors: string[] = []
      let error = (e: unknown) => {
        if (errors.length < 100) errors.push(message(e))
      }
      page.on('console', (m) => {
        if (console.length < 100) {
          console.push({ type: m.type(), text: m.text().slice(0, 2000) })
        }
      })
      page.on('pageerror', error)
      page.on('error', error)
      await page.setViewport(viewport(view))
      if (cookies.length) await page.setCookie(...cookies)
      let status = 0
      try {
        status = (await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 10_000,
        }))?.status() ?? 0
      } catch (e) {
        error(e)
      }
      if (view.wait) await sleep(view.wait, undefined, time)
      // A step that fails ends the steps: what follows it assumed it worked.
      // The failure is the visit's error, and the page is still pictured.
      let shots: Rendered['shots'] = []
      let shoot = () => page.screenshot({ type: 'png', encoding: 'base64' })
      for (let [i, step] of steps.entries()) {
        try {
          if ('shot' in step) {
            shots.push({ name: step.shot, image: await shoot() })
          } else await taken(page, view, step, time)
        } catch (e) {
          error(new Error(`step ${i + 1} ${said(step)}: ${message(e)}`))
          break
        }
      }
      let image = await shoot()
      return { page, image, shots, console, errors, status }
    })())
    cancel()
    let { page, ...rest } = loaded
    result = { ...rest, ...await checked(page, browsing.axe, time) }
  } finally {
    cancel()
    try {
      await browser.close()
    } finally {
      duration = Math.max(0, time.now() - start)
      await used(duration)
    }
  }
  return { ...result, duration }
}

/**
 * yak-browser's answer to a posted `Visit`: what `capture` rendered,
 * or the reason it could not, as a 500. Both carry the browser time held, so
 * the kernel charges it either way.
 */
export let answer =
  (browsing: Browsing, time: Clock = system) =>
  async (req: Request): Promise<Response> => {
    let duration = 0
    try {
      let visit = await req.json() as Visit
      return Response.json(
        await capture(browsing, visit, (ms) => {
          duration = ms
          return Promise.resolve()
        }, time),
      )
    } catch (e) {
      let failed: Failed = {
        failed: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        duration,
      }
      return Response.json(failed, { status: 500 })
    }
  }
