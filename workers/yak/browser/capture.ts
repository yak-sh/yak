// What yak-browser does with a request: a page's address, viewport and the
// cookies it is opened with posted in, its screenshot, text, console, errors,
// status and accessibility check out, with the browser time it held. Browser control runs on Cloudflare; the small
// session interface lets the load, diagnostics and cleanup run in process
// without a local browser.
import { type Clock, sleep, system } from '@yaks/fp'
import { audit, type Axe, type Checked } from '../accessibility.ts'

export type View = { width: number; height: number; wait: number }
/** A cookie the page is opened with: a private app's sign-in. */
export type Cookie = {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
}
/** What yak-browser is asked to open. */
export type Visit = { url: string; view: View; cookies?: Cookie[] }
export type Message = { type(): string; text(): string }
type Events = { console: Message; pageerror: unknown; error: Error }
export type Page = {
  on<Event extends keyof Events>(
    event: Event,
    hear: (value: Events[Event]) => void,
  ): unknown
  setViewport(view: { width: number; height: number }): Promise<void>
  setCookie(...cookies: Cookie[]): Promise<void>
  goto(url: string, options: {
    waitUntil: 'domcontentloaded'
    timeout: number
  }): Promise<{ status(): number } | null>
  createCDPSession(): Promise<Session>
  screenshot(options: { type: 'png'; encoding: 'base64' }): Promise<string>
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

let message = (error: unknown) =>
  (error instanceof Error ? error.stack ?? error.message : String(error)).slice(
    0,
    2000,
  )

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

// A session Cloudflare just acquired may not take a connection yet: its
// websocket upgrade answers without a socket. The connect is retried on the
// same session, with growing pauses, before the preview fails.
let pauses = [250, 500, 1000]
let open = async (
  { acquire, connect }: Browsing,
  time: Clock,
): Promise<Browser> => {
  let session = await acquire()
  for (let pause of pauses) {
    try {
      return await connect(session)
    } catch {
      await sleep(pause, undefined, time)
    }
  }
  return connect(session)
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

/** How much of a page's visible text a render carries. */
export let TEXT = 6000

// A check that fails is its own result: the preview keeps its screenshot,
// console and errors, and the kernel reports the failure (../browser.ts). The
// page's visible text is read in the same world after the audit, so nothing
// the page adds to its globals changes how it is read; a check that failed
// read none.
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
    return { accessibility: { failed: message(e) }, text: '' }
  } finally {
    cancel()
  }
}

export let capture = async (
  browsing: Browsing,
  { url, view, cookies = [] }: Visit,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  time: Clock = system,
): Promise<Rendered> => {
  let start = time.now()
  let browser = await open(browsing, time)
  let duration = 0
  let { bounded, cancel } = deadline(time, RENDER, 'Browser preview timed out')
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
      await page.setViewport({ width: view.width, height: view.height })
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
      let image = await page.screenshot({ type: 'png', encoding: 'base64' })
      return { page, image, console, errors, status }
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
