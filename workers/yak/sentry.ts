// The platform's defects, sent to Sentry (T-37865): org `yaks`, project
// `yaks-app`. The kernel's default export and its Durable Objects are wrapped
// (index.ts), so an exception nothing caught arrives on its own; the seams
// that catch a defect on purpose — the router's catch and the jobs
// (unseen.ts `fault`), a Store's own (graph.ts `#broke`), a connector tool
// (mcp.ts) — hand it to `defect` with who and where it happened as tags.
//
// The DSN is the `SENTRY_DSN` secret, and without it the SDK sends nothing:
// the tests and a local `wrangler dev` stay silent. The release is the
// deployed Workers version (the SDK reads `CF_VERSION_METADATA`), and the
// environment is `SENTRY_ENVIRONMENT` from wrangler.toml's vars, so a new
// issue names the deploy that brought it.
//
// Only defects. A refusal is the platform answering, never sent: the runner
// keeps `CallError` from `report`, and the router returns before it reports
// one (unseen.ts `refusal`).
//
// What leaves is the error and its tags, nothing a person said: no request
// headers (a cookie, a bearer), no query string (an OAuth code), no body, and
// none of the arguments a console line carried (`scrub`).
// It speaks @sentry/core, never @sentry/cloudflare, whose types declare the
// Workers runtime as globals and would redefine `Response` for every file the
// repo-wide check reads (conform.ts says the same of workers-types). One copy
// of @sentry/core is bundled, so the client index.ts's wrappers start is the
// one these calls reach.
import {
  captureConsoleIntegration,
  captureException,
  type ErrorEvent,
  withScope,
} from '@sentry/core'
import type { Bundle, Comp } from '@yaks/graph'
import { isTestAddress } from '../../src/bots.ts'
import type { Ctx } from './tools.ts'

/** Who hit a defect: the person's eid, and whether that account is a person
 * or a test account (src/bots.ts), so Sentry can filter to people. */
export type Hit = { id: string; account: 'person' | 'test' }

/** What an event keeps: the error, its tags and user, and where it happened
 * — the URL without its query, the method. */
export let scrub = (event: ErrorEvent): ErrorEvent => {
  if (event.request) {
    let { url, method } = event.request
    event.request = {
      ...(url ? { url: url.split('?')[0] } : {}),
      ...(method ? { method } : {}),
    }
  }
  if (event.extra) delete event.extra.arguments
  return event
}

/** The SDK's options for every wrapped handler and object. `dsn`, `release`
 * and `environment` come from the env the SDK is handed. */
export let options = () => ({
  // Errors are the point; a few traces are enough to see a slow door.
  tracesSampleRate: 0.05,
  sendDefaultPii: false,
  // A `console.error` anywhere in the kernel is a defect someone wrote down
  // (a Store answering 500, a purge refused), which is what the old tail
  // worker paged on.
  integrations: [captureConsoleIntegration({ levels: ['error'] })],
  beforeSend: scrub,
})

/** One defect, with where it happened as tags and who hit it as the user. A
 * tag with no value is left off. */
export let defect = (
  error: unknown,
  tags: Record<string, string | null | undefined>,
  hit?: Hit,
) =>
  withScope((scope) => {
    for (let [k, v] of Object.entries(tags)) if (v) scope.setTag(k, v)
    if (hit) {
      scope.setUser({ id: hit.id })
      scope.setTag('account', hit.account)
    }
    captureException(error)
  })

// The space and app a call's arguments named, and nothing else it said.
let aimedAt = (args: unknown): { space?: string; app?: string } => {
  let said: Record<string, unknown> = {}
  try {
    said = JSON.parse(String(args ?? '{}')) ?? {}
  } catch { /* no arguments to read */ }
  let slug = (v: unknown) => typeof v == 'string' ? v : undefined
  return { space: slug(said.space), app: slug(said.app) }
}

// Whether the caller is a person or a test account (src/bots.ts), so Sentry
// can be filtered to what people hit. An address that cannot be read is a
// person's: the safe direction to be wrong in.
let accountOf = async (ctx: Ctx): Promise<Hit | undefined> => {
  if (!ctx.person) return undefined
  let email = await ctx.dir.emailAt(ctx.person).catch(() => null)
  return {
    id: ctx.person,
    account: isTestAddress(email ?? '') ? 'test' : 'person',
  }
}

/** A connector tool's defect, sent with the tool, the space and
 * app its arguments named, the client that connected, and the person who
 * called it. A refusal never arrives here: the runner keeps `CallError`
 * back. */
export let reporter =
  (ctx: Ctx, client?: string) =>
  async (err: unknown, call: Bundle, tool?: string) =>
    defect(
      err,
      {
        tool,
        ...aimedAt((call.call as Comp | undefined)?.args),
        client,
      },
      await accountOf(ctx),
    )
