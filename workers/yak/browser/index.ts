// yak-browser's entry: puppeteer over Cloudflare's browser, and axe-core's
// browser bundle for the check, both in this Worker's script so only the
// isolates that render a draft compile them (capture.ts takes them in process).
import puppeteer from '@cloudflare/puppeteer'
import axe from './axe.json' with { type: 'json' }
import type { Fetcher } from '../door.ts'
import { answer } from './capture.ts'

let endpoint = (env: { BROWSER: Fetcher }) => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    env.BROWSER.fetch(new Request(input, init)),
})

export default {
  fetch: (req: Request, env: { BROWSER: Fetcher }): Promise<Response> =>
    answer({
      acquire: async () => (await puppeteer.acquire(endpoint(env))).sessionId,
      connect: (session) => puppeteer.connect(endpoint(env), session),
      axe,
    })(req),
}
