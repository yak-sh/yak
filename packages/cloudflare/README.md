# @yaks/cloudflare

Cloudflare's account API as code outside a binding reaches it: yaks.app's kernel
Worker, the deploy doors of every Worker in this repository, and the box's admin
(@yaks/admin). Each brings its own token, paths and queries; this package owns
only how a call is sent, how an answer is read, and which Wrangler runs. No
graph, credential lookup, server or wrangler.toml lives here.

Unpublished: it pins the `wrangler` npm package, and its callers are this
repository's.

## Exports

- `./api`: `accountUrl({CF_ACCOUNT, WORKERS_API?}, path)` names a path under the
  account; `resent(url, init, {idempotent?}, wait?)` is `fetch` that sends an
  idempotent call again when Cloudflare fails it on its own side (a 5xx, a 429
  whose Retry-After a resend rides out, or a dropped connection), about eight
  seconds in all. `failure(status, message)` throws `Unavailable` for
  Cloudflare's own failure and an `Error` for a refusal; `passing(status)` tells
  the two apart. An `Unavailable` is an outage, not a broken call.
- `./analytics`: `ask(env, query, variables)` posts a GraphQL query with the
  analytics token (`CF_ANALYTICS_TOKEN`, aimed at `ANALYTICS_API` when a probe
  sets it), and `said(answer)` reads its data or throws its errors, as
  `Unavailable` when every one is Cloudflare's internal failure. `api(env)` is
  where analytics reads go, the Analytics Engine SQL API's base as well.
- `./hook`: `hooked(status, body)` reads Workers Builds' answer to a deploy hook
  POST: whether it started a build, which, and in words. `PENDING` is what it
  says when a build of the branch already waits, which started nothing.
- `./wrangler`: `WRANGLER` is the argv prefix that runs the pinned Wrangler,
  `WRANGLER_VERSION` its version. `command(args)` is the subcommand past any
  `--env`; `failure(args, result)` is what a failed run throws, one
  `cloudflare api failed` fault whichever endpoint met Cloudflare's outage;
  `retried(args, execute, {attempts?})` runs a step again with backoff while
  that outage lasts. `versionMessage(commit, began)` and `beganIn(message)`
  write and read the `began:` line a deploy door leaves on a version.

```ts
import { accountUrl, failure, Unavailable } from '@yaks/cloudflare/api'
import { hooked, PENDING } from '@yaks/cloudflare/hook'

let url = accountUrl({ CF_ACCOUNT: 'a' }, '/workers/scripts')
console.assert(url.endsWith('/accounts/a/workers/scripts'))
console.assert(failure(503, 'down') instanceof Unavailable)
console.assert(
  hooked(200, { success: true, result: { already_exists: true } }).said ==
    PENDING,
)
```
