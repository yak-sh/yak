import type { Scope } from './worker.ts'

let REPORTS = 'yak-open-reports'

/** Keep a bounded set of open reports when the network is offline and send
 * them on the next report. Signing in or out takes them away with the pages. */
export let keptReports = (
  scope: Scope,
  path: string,
  forgotAt: () => Promise<number>,
): {
  forget(): Promise<boolean>
  send(req: Request): Promise<Response>
} => {
  let { caches, location } = scope
  let sending: Promise<void> | undefined
  let kept = () => caches.open(REPORTS)
  let replay = async (req: Request) => {
    let box = await kept()
    for (let key of await box.keys()) {
      let held = await box.match(key)
      if (!held) continue
      let at = Number(held.headers.get('x-kept-at'))
      if (Date.now() - at < 24 * 60 * 60_000 && at >= await forgotAt()) {
        let res = await scope.fetch(req.url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'text/plain' },
          referrer: held.headers.get('x-kept-referrer') || 'about:client',
          body: await held.text(),
        })
        if (res.status >= 500) return
      }
      await box.delete(key)
    }
  }
  let save = async (req: Request, at: number) => {
    let body = await req.text()
    if (body.length > 8192 || at < await forgotAt()) return
    let box = await kept()
    let key = new URL(path, location.origin)
    key.searchParams.set('id', crypto.randomUUID())
    await box.put(
      key.href,
      new Response(body, {
        headers: { 'x-kept-at': String(at), 'x-kept-referrer': req.referrer },
      }),
    )
    let keys = await box.keys()
    await Promise.all(keys.slice(0, -24).map((r) => box.delete(r)))
  }
  return {
    forget: () => caches.delete(REPORTS),
    send: async (req) => {
      let at = Date.now()
      let copy = req.clone()
      let got = await scope.fetch(req).catch(() => null)
      if (got && got.status < 500) {
        void copy.body?.cancel()
        sending ??= replay(req).catch(() => {}).finally(() => {
          sending = undefined
        })
        await sending
        return got
      }
      await save(copy, at)
      return new Response(null, { status: 204 })
    },
  }
}
