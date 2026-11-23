# @yaks/cloudflare

Cloudflare's account API as code outside a binding reaches it: yaks.app's kernel
Worker, the deploy doors of every Worker in this repository, and the box's admin
(@yaks/admin). Each brings its own token, paths and queries; this package owns
only how a call is sent, how an answer is read, which Wrangler runs and what a
deployment says serves. No graph, server or wrangler.toml lives here.

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
- `./registrar`: Cloudflare Registrar on the account, as @yaks/domains asks for
  a registry (`registry({CF_ACCOUNT, WORKERS_API?, token})`): `search`, `check`
  (price and whether a name can be registered now, in cents), `register` (sent
  once, charged to the account's default payment method), `registration` (its
  workflow, null where never asked), `renewing` (the domain's `auto_renew`,
  which is how renewal happens) and `zone` (the account's zone for a name, made
  where there is none). `answered(response)` in `./api` reads the
  `{success, errors, result}` envelope every call answers.
- `./analytics`: `ask(env, query, variables)` posts a GraphQL query with the
  analytics token (`CF_ANALYTICS_TOKEN`, aimed at `ANALYTICS_API` when a probe
  sets it), and `said(answer)` reads its data or throws its errors, as
  `Unavailable` when every one is Cloudflare's internal failure. `api(env)` is
  where analytics reads go, the Analytics Engine SQL API's base as well.
- `./deployed`: what serves a Worker. `reads(root, headers)` reads a config's
  deployments and versions through the account API, with the headers
  `credentials(WRANGLER, root)` gets from Wrangler's own login;
  `script(toml,
  env)` is the script and account a config names in an
  environment. `serving(deployments)` says what serves now and the commit its
  message names (`shaIn`); `sole(deployments)` is the newest deployment when one
  version has all the traffic; `commits(reads, config, env)` is every commit
  live now.
- `./hook`: `hooked(status, body)` reads Workers Builds' answer to a deploy hook
  POST: whether it started a build, which, and in words. `PENDING` is what it
  says when a build of the branch already waits, which started nothing.
- `./wrangler`: `WRANGLER` is the argv prefix that runs the pinned Wrangler,
  `WRANGLER_VERSION` its version. `command(args)` is the subcommand past any
  `--env`; `failure(args, result)` is what a failed run throws, one
  `cloudflare api failed` fault whichever endpoint met Cloudflare's outage;
  `retried(args, execute, {attempts?})` runs a step again with backoff while
  that outage lasts. `versionMessage(commit, began)` and `beganIn(message)`
  write and read the `began:` line a deploy door leaves on a version;
  `noted(message, ...lines)` adds lines, cutting the subject so that every line
  fits the 1,000 characters (`MESSAGE`) Cloudflare keeps of a message.

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
