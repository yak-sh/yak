// A draft rendered for app_preview. The rendering is yak-browser's (browser/),
// the Worker behind the BROWSER binding, so puppeteer and axe-core are never
// in this Worker's script: every isolate compiles that, a page view's included.
import { system } from '@yaks/fp'
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import type { Failed, Rendered, View } from './browser/capture.ts'

// A failure yak-browser answered, raised here with the stack it had there.
let relayed = ({ failed, stack }: Failed) =>
  Object.assign(new Error(failed), stack ? { stack } : {})

// yak-browser's answer: a render, or a failure it reports as a 500.
let answered = async (r: Response) => {
  let said = await r.json().catch(() => null) as Rendered | Failed | null
  if (said && (r.ok || 'failed' in said)) return said
  throw new Error(`yak-browser ${r.status}`)
}

/**
 * What yak-browser rendered of `url`, charged through `used` the browser time
 * it held, failing or not; the time this waited when it could not say. A check
 * that failed stays the preview's own result and is reported here, for the
 * tracker to hear, tagged with `where` the preview was of.
 */
export let render = async (
  env: Pick<Env, 'BROWSER' | 'CLOCK'>,
  url: string,
  view: View,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  where: Record<string, string> = {},
): Promise<Rendered> => {
  if (!env.BROWSER) {
    throw new Error('Cloudflare Browser Rendering is not configured')
  }
  let time = env.CLOCK ?? system
  let start = time.now()
  let said: Rendered | Failed | undefined
  try {
    said = await answered(
      await env.BROWSER.fetch(
        new Request('https://browser.invalid/', {
          method: 'POST',
          body: JSON.stringify({ url, view }),
        }),
      ),
    )
  } finally {
    await used(said?.duration ?? Math.max(0, time.now() - start))
  }
  if ('failed' in said) throw relayed(said)
  if ('failed' in said.accessibility) {
    caught(new Error(said.accessibility.failed), {
      request: 'app_preview accessibility',
      ...where,
    })
  }
  return said
}
