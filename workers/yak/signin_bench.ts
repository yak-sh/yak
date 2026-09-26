// How long a cold sign-in takes (T-34138). A first sign-in on 2026-09-04 took
// 32.4 seconds of wall time against 28.7ms of CPU, an unbounded wait rather
// than work. It is measured here and not asserted in a test, where a loaded
// box turns a slower number into a red gate: the four requests a browser
// makes, on a kernel whose stores do not exist yet, with the kernel's own
// start outside the span.
//
//   deno bench -A --unstable-net workers/yak/signin_bench.ts
import { type Kernel, kernel, mailed } from './probe.ts'

let form = (k: Kernel, path: string, fields: Record<string, string>) =>
  k.at('yaks.app', path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })

Deno.bench(
  'a cold sign-in: the card, the address, the code, the page',
  { n: 20, warmup: 2 },
  async (b) => {
    let k = await kernel()
    try {
      let email = 'cold@yaks.app'
      b.start()
      await (await k.at('yaks.app', '/login')).body?.cancel()
      await (await form(k, '/login', { email })).body?.cancel()
      let inn = await form(k, '/login/code', {
        email,
        code: await mailed(k, email),
      })
      await inn.body?.cancel()
      let to = new URL(inn.headers.get('location') ?? '/', 'https://yaks.app')
      let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
      let page = await k.at(to.hostname, to.pathname + to.search, {
        headers: { cookie },
      })
      await page.body?.cancel()
      b.end()
      if (page.status != 200) throw new Error(`landed on ${page.status}`)
    } finally {
      await k.stop()
    }
  },
)
