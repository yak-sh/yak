import { misfit, status } from '@yaks/graph/errors'

type Mistake = {
  request: string
  version: number | null
  message: string
  mistake: true
}

type Reporter = {
  version: () => Promise<number | null>
  note: (report: Mistake) => Promise<unknown>
}

// Only the app's own page speaks for its code. A tool or another site may
// have written a different query; a schema's bound is the visitor's input.
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
  if (
    !req.headers.has('x-yak-version') &&
    req.headers.get('sec-fetch-site') != 'same-origin'
  ) return
  let raw = req.headers.get('x-yak-version')
  let version = raw != null && /^[0-9]+$/.test(raw) &&
      Number.isSafeInteger(Number(raw))
    ? Number(raw)
    : await reporter.version()
  let url = new URL(req.url)
  await reporter.note({
    request: `${req.method} ${url.pathname}${url.search}`,
    version,
    message: error instanceof Error ? error.message : String(error),
    mistake: true,
  })
}
