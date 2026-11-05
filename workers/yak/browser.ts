// Browser control runs on Cloudflare. The small session interface lets the
// load, diagnostics and cleanup run in process without a local browser.
import { type Clock, sleep, system } from '@yaks/fp'
import type { Env } from './env.ts'
import { audit, type Checked } from './accessibility.ts'
import { caught } from './defects.ts'

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
export type Browser = {
  newPage(): Promise<Page>
  close(): Promise<void>
}

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
// console and errors, and the failure is ours, so the tracker hears of it.
let checked = async (
  page: Page,
  bounded: <T>(work: Promise<T>) => Promise<T>,
): Promise<Checked> => {
  try {
    return await bounded(isolated(page).then(audit))
  } catch (e) {
    caught(e, { request: 'app_preview accessibility' })
    return { failed: message(e) }
  }
}

export let capture = async (
  open: () => Promise<Browser>,
  url: string,
  view: View,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  time: Clock = system,
) => {
  let start = time.now()
  let browser = await open()
  let duration = 0
  let { bounded, cancel } = deadline(time)
  let result: {
    image: string
    console: { type: string; text: string }[]
    errors: string[]
    status: number
    accessibility: Checked
  }
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
    result = { ...rest, accessibility: await checked(page, bounded) }
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

export let render = async (
  env: Pick<Env, 'BROWSER' | 'CLOCK'>,
  url: string,
  view: View,
  used?: (duration: number) => Promise<void>,
) => {
  let puppeteer = (await import('@cloudflare/puppeteer')).default
  if (!env.BROWSER) {
    throw new Error('Cloudflare Browser Rendering is not configured')
  }
  let binding = env.BROWSER
  return capture(
    () =>
      puppeteer.launch({
        fetch: (input, init) => binding.fetch(new Request(input, init)),
      }),
    url,
    view,
    used,
    env.CLOCK,
  )
}
