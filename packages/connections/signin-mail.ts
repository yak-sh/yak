// The sign-in code is read from this graph's incoming mail, never a token argument.
import type { Bundle, Comp, Query } from '@yaks/graph'
import { type And, and, eq, ge, limit, want } from '@yaks/query'

let prop = (b: Bundle, name: string, field: string) =>
  (b[name] as Comp)?.[field]
let SUBJECT = /\b(\d{6})\b is your yaks\.app code/
export let codeIn = (
  letters: Bundle[],
  address: string,
  since: number,
): string | null => {
  let seen = letters.map((b) => ({
    code: SUBJECT.exec(String(prop(b, 'doc', 'title') ?? ''))?.[1],
    to: String(prop(b, 'mail', 'to') ?? ''),
    at: Date.parse(String(prop(b, 'mail', 'at') ?? '')),
  })).filter((m) => m.code && m.to == address && m.at >= since)
    .sort((a, b) => b.at - a.at)
  return seen[0]?.code ?? null
}
export let lettersFor = (address: string, since: number): And =>
  and(
    eq('mail.to', address),
    ge('mail.at', new Date(since).toISOString()),
    want('doc'),
    limit(10),
  )
export let codeFor = async (
  read: (q: Query) => Bundle[] | Promise<Bundle[]>,
  address: string,
  since: number,
  opts: {
    wait?: number
    poll?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<string> => {
  let now = opts.now ?? Date.now
  let sleep = opts.sleep ??
    ((ms) => new Promise<void>((go) => setTimeout(go, ms)))
  // A delayed mail pull does not invalidate the code's ten-minute lifetime.
  let deadline = since + (opts.wait ?? 10 * 60_000)
  for (;;) {
    let code = codeIn(await read(lettersFor(address, since)), address, since)
    let left = deadline - now()
    if (code && left > 0) return code
    if (left <= 0) {
      throw new Error(
        `no sign-in code for ${address}; this graph must receive its mail`,
      )
    }
    await sleep(Math.min(opts.poll ?? 3_000, left))
  }
}
