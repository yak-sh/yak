// Browser control runs on Cloudflare. The small session interface lets the
// load, diagnostics and cleanup run in process without a local browser.
import { type Clock, sleep, system } from '@yaks/fp'
import type { Env } from './env.ts'

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
  screenshot(options: { type: 'png'; encoding: 'base64' }): Promise<string>
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

let bounded = async <T>(work: () => Promise<T>, time: Clock): Promise<T> => {
  let cancel = () => {}
  let timeout = new Promise<never>((_, reject) => {
    cancel = time.after(
      15_000,
      () => reject(new Error('Browser preview timed out')),
    )
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    cancel()
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
  let result: {
    image: string
    console: { type: string; text: string }[]
    errors: string[]
    status: number
  }
  try {
    result = await bounded(async () => {
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
      return { image, console, errors, status }
    }, time)
  } finally {
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
