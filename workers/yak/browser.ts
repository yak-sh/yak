// A page rendered for app_preview: a draft, or the released app. The rendering is yak-browser's (browser/),
// the Worker behind the BROWSER binding, so puppeteer and axe-core are never
// in this Worker's script: every isolate compiles that, a page view's included.
import { system } from '@yaks/fp'
import { CallError } from '@yaks/tools/errors'
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import type { Checked } from '@yaks/platform/preview-audit'
import {
  bounded,
  BROWSE_REPLY,
  BrowserTimeout,
  type Fault,
  PREVIEW_REPLY,
  type Rendered,
  type Reply,
  type Visit,
  waitRoom,
} from '@yaks/platform/browser-visit'

// A failure yak-browser answered, raised here with the stack it had there.
let relayed = ({ failed, stack, timeout }: Fault) =>
  Object.assign(new Error(failed), { timeout }, stack ? { stack } : {})

export let timedOut = (error: unknown) =>
  error instanceof BrowserTimeout ||
  (error instanceof Error && 'timeout' in error && error.timeout === true)

// yak-browser's answer: a render, or a failure it reports as a 500.
let answered = async (r: Response) => {
  let said = await r.json().catch(() => null) as Reply | null
  if (said && (r.ok || 'failed' in said)) return said
  throw new Error(`yak-browser ${r.status}`)
}

/**
 * What yak-browser saw of a visit, charged through `used` the browser time it
 * held, failing or not; the time this waited when it could not say. An
 * accessibility check that failed stays the visit's own result and is reported
 * here, for the tracker to hear, tagged with `where` the visit was of.
 */
export let seen = async (
  env: Pick<Env, 'BROWSER' | 'CLOCK'>,
  visit: Visit,
  used: (duration: number) => Promise<void> = () => Promise.resolve(),
  where: Record<string, string> = {},
): Promise<Rendered> => {
  if (!env.BROWSER) {
    throw new Error('Cloudflare Browser Rendering is not configured')
  }
  let time = env.CLOCK ?? system
  let start = time.now()
  let said: Reply | undefined
  try {
    let browser = env.BROWSER
    said = await bounded(
      time,
      visit.audit === false ? BROWSE_REPLY + waitRoom(visit) : PREVIEW_REPLY,
      () => 'Waiting for the browser service to answer',
      async (signal) =>
        answered(
          await browser.fetch(
            new Request('https://browser.invalid/', {
              method: 'POST',
              body: JSON.stringify(visit),
              signal,
            }),
          ),
        ),
    )
  } finally {
    await used(said?.duration ?? Math.max(0, time.now() - start))
  }
  let { faults = [], ...reply } = said
  for (let fault of faults) caught(relayed(fault), where)
  if ('failed' in reply) {
    if (reply.refusal) throw new CallError(reply.refusal, reply.failed)
    throw relayed(reply)
  }
  if (reply.accessibility && 'failed' in reply.accessibility) {
    caught(new Error(reply.accessibility.failed), {
      request: 'app_preview accessibility',
      ...where,
    })
  }
  return reply
}

/** A render for app_preview: what {@link seen} answers, its accessibility
 * always checked. */
export let render = async (
  env: Pick<Env, 'BROWSER' | 'CLOCK'>,
  visit: Visit,
  used?: (duration: number) => Promise<void>,
  where?: Record<string, string>,
): Promise<Rendered & { accessibility: Checked }> => {
  let said = await seen(env, { ...visit, audit: true }, used, where)
  let { accessibility } = said
  if (!accessibility) throw new Error('yak-browser ran no accessibility check')
  return { ...said, accessibility }
}
