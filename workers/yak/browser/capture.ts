// What yak-browser does with a request: a draft's address and viewport posted
// in, its screenshot, console, errors, status and accessibility check out, with
// the browser time it held. Browser control runs on Cloudflare; the small
// session interface lets the load, diagnostics and cleanup run in process
// without a local browser.
import { type Clock, sleep, system } from '@yaks/fp'
import { audit, type Axe, type Checked } from '../accessibility.ts'

export type View = { width: number; height: number; wait: number }
export type Message = { type(): string; text(): string }
type Events = { console: Message; pageerror: unknown; error: Error }
export type Page = {
  on<Event extends keyof Events>(
    event: Event,
    hear: (value: Events[Event]) => void,
  ): unknown
  setViewport(view: { width: number; height: number }): Promise<void>
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

/** A rendered draft, and the browser time it took. */
export type Rendered = {
  image: string
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

// One deadline bounds the whole preview, its accessibility check included.
let deadline = (time: Clock) => {
  let cancel = () => {}
  let timeout = new Promise<never>((_, reject) => {
    cancel = time.after(
      15_000,
      () => reject(new Error('Browser preview timed out')),
    )
  })
  timeout.catch(() => {})
  return {
    bounded: <T>(work: Promise<T>) => Promise.race([work, timeout]),
    cancel,
  }
}

// A check that fails is its own result: the preview keeps its screenshot,
// console and errors, and the kernel reports the failure (../browser.ts).
let checked = async (
  page: Page,
  axe: Axe,
  bounded: <T>(work: Promise<T>) => Promise<T>,
): Promise<Checked> => {
  try {
    return await bounded(isolated(page).then((world) => audit(world, axe)))
  } catch (e) {
    return { failed: message(e) }
  }
}

export let capture = async (
  browsing: Browsing,
  url: string,
  view: View,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  time: Clock = system,
): Promise<Rendered> => {
  let start = time.now()
  let browser = await open(browsing, time)
  let duration = 0
  let { bounded, cancel } = deadline(time)
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
    let { page, ...rest } = loaded
    result = {
      ...rest,
      accessibility: await checked(page, browsing.axe, bounded),
    }
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
 * yak-browser's answer to a posted `{ url, view }`: what `capture` rendered,
 * or the reason it could not, as a 500. Both carry the browser time held, so
 * the kernel charges it either way.
 */
export let answer =
  (browsing: Browsing, time: Clock = system) =>
  async (req: Request): Promise<Response> => {
    let duration = 0
    try {
      let { url, view } = await req.json() as { url: string; view: View }
      return Response.json(
        await capture(browsing, url, view, (ms) => {
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
