import { misfit, status } from '@yaks/graph/errors'

type Mistake = {
  request: string
  version: number
  message: string
  mistake: true
}

type Reporter = {
  note: (report: Mistake) => Promise<unknown>
}

// Only the app's own page speaks for its code, and client.js says so: every
// request it sends names the release its page runs (`x-yak-version`, from the
// page's woven `data-yak-version`). Anything else wrote its own line, even
// from the page's origin, which a query typed into the console or an agent's
// script run in the page shares with the page's code: its refusal is that
// caller's to read. A schema's bound is the visitor's input.
export let mistaken = async (
  req: Request,
  error: unknown,
  entrypoint: 'query' | 'apply',
  reporter: Reporter,
) => {
  let code = error instanceof Error && 'status' in error
    ? error.status
    : status(error)
  if (entrypoint == 'apply' ? !misfit(error) : code != 400) return
  let version = release(req)
  if (version == null) return
  let url = new URL(req.url)
  await reporter.note({
    request: `${req.method} ${url.pathname}${url.search}`,
    version,
    message: error instanceof Error ? error.message : String(error),
    mistake: true,
  })
}

let release = (req: Request) => {
  let raw = req.headers.get('x-yak-version')
  let n = Number(raw)
  return raw != null && /^[0-9]+$/.test(raw) && Number.isSafeInteger(n)
    ? n
    : null
}
