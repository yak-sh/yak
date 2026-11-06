// yak-browser's entry: puppeteer over Cloudflare's browser, and axe-core's
// browser bundle for the check, both in this Worker's script so only the
// isolates that render a draft compile them (capture.ts takes them in process).
import puppeteer from '@cloudflare/puppeteer'
import axe from './axe.json' with { type: 'json' }
import type { Fetcher } from '../door.ts'
import { answer } from './capture.ts'

export default {
  fetch: (req: Request, env: { BROWSER: Fetcher }): Promise<Response> =>
    answer({
      open: () =>
        puppeteer.launch({
          fetch: (input, init) => env.BROWSER.fetch(new Request(input, init)),
        }),
      axe,
    })(req),
}
