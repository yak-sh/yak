// yak-browser's entry: puppeteer over Cloudflare's browser, and axe-core's
// browser bundle for the check, both in this Worker's script so only the
// isolates that render a draft compile them. `Session` lends the browser as
// it is to a script, which brings its own puppeteer (code-runtime.ts).
import puppeteer from '@cloudflare/puppeteer'
import { WorkerEntrypoint } from 'cloudflare:workers'
import axe from './axe.json' with { type: 'json' }
import type { Fetcher } from '../door.ts'
import { answer } from '@yaks/platform/browser-visit'
import type { Hold } from '@yaks/fp'

type Binding = Fetcher & {
  closeSession(session: string): Promise<unknown>
}

let endpoint = (binding: Binding, signal: AbortSignal) => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    binding.fetch(new Request(input, { ...init, signal })),
})

// Typed as the base it is to this Worker alone: under Deno's own check of
// this file, `cloudflare:workers` is untyped.
let Entrypoint = WorkerEntrypoint as unknown as new (
  ctx: unknown,
  env: { BROWSER: Binding },
) => { env: { BROWSER: Binding } }

export class Session extends Entrypoint {
  fetch(req: Request): Promise<Response> {
    return this.env.BROWSER.fetch(req)
  }
}

export default {
  fetch: (
    req: Request,
    { BROWSER }: { BROWSER: Binding },
    ctx: { waitUntil: Hold },
  ): Promise<Response> =>
    answer(
      {
        acquire: async (signal) =>
          (await puppeteer.acquire(endpoint(BROWSER, signal), {
            keep_alive: 30_000,
          })).sessionId,
        connect: (session, signal) =>
          puppeteer.connect(endpoint(BROWSER, signal), session),
        release: async (session) => {
          await BROWSER.closeSession(session)
        },
        axe,
      },
      undefined,
      ctx.waitUntil.bind(ctx),
    )(req),
}
