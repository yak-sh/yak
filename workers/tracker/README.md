# Tracker Worker

An independent Worker consumes `yak-errors` into one Durable Object graph for
`platform` and one per space's global eid. It imports the same vocabulary,
reporter, grouping, effects and resolution as `@yaks/tracker`. It has no binding
to yak; queue intake does not depend on a directory or authentication lookup.

## Run and build

```sh
deno run -A workers/tracker/wrangler.ts deploy --dry-run
deno task test workers/tracker packages/effects/pool_test.ts
deno run -A workers/tracker/scratch.ts
```

The scratch harness owns one workerd runtime, closes it in `finally`, and
removes its scratch directory. It checks SQLite intake, duplicate delivery,
tenant authorization, subscription frames, heartbeat intake and the queue canary
through the runtime consumer. It sends no email and deploys nothing. The build
door uses the pinned Wrangler and workspace paths from
`workers/yak/wrangler.ts`; npm dependencies are installed with
`npm ci --prefix workers/yak` before a cold build.

## Access and RPC

`TRACKER_SECRET` is a dedicated tracker signing secret, not a session secret. An
authorized host issues a short-lived ticket using `auth.ts` `sign()` only after
checking the caller's platform administration or space membership. A ticket
names exactly one global scope and cannot cross into another store. Platform
tickets also require `admin: true`. No directory lookup runs here.

```ts ignore
import { sign } from './auth.ts'
let ticket = await sign({
  scope: spaceEid,
  person: personEid,
  exp: Date.now() / 1000 + 300,
}, trackerSecret)
let bugs = await fetch(`${trackerUrl}/bugs?scope=${spaceEid}&app=${appEid}`, {
  headers: { authorization: `Bearer ${ticket}` },
}).then((response) => response.json())
```

Authenticated endpoints: `/bugs`, `/unseen`, `/traces`, `/trace`, `/query`,
`/vocab`, `/ws`, `POST /resolve` and `/archive` with `{bug}`, and
`POST /deployed` with `{app}`. `/ws?scope=…&ticket=…` accepts subscriptions,
unsubscribe and ACK only, never relay writes. `/query` returns graph bundles.
General `/apply` and HTTP intake are absent.
`GET /traces?app=<global-eid>&limit=50&after=<trace-eid>` returns
`{rows, next?}` ordered by descending `trace.at`.
`GET /trace?eid=<trace-eid>&limit=100&after=<span-eid>` returns
`{trace, spans, next?}`; span pages are ordered by entity eid, and each span
preserves its separate metric components. Both page limits are 1–100. The `next`
eid is supplied as `after` to continue. A trace can be visible while later queue
chunks are still arriving.

Trusted queue batches carry reporter bundles with `during.space` by global eid;
a mixed-space batch never reaches a store. Each message is acknowledged only
after graph admission. Redelivery preserves grouping receipts and bug hit
counts. Trace-only batches contain `trace` or `span` entities, each with its own
`during.space`. A message holds at most 100 bundles; span-only chunks can arrive
before their trace or parent. Reference placeholder entities are not intake
receipts, so later delivery fills their components, while a redelivery preserves
existing metrics.

Platform-only `POST /heartbeat` renews the box heartbeat. Cron probes the MCP
endpoint and tracks an activated box heartbeat older than five minutes. The
platform graph batches notification mail through its own `MAIL` binding, with
`MAIL_FROM` and `MAIL_TO` configured at activation. Space bugs stream through
their store's graph subscription and remain unseen until their caller marks
notification in the platform integration.

## Activation and deployment

Account setup supplies `yak-errors`, `yak-errors-dead`, a Workers Builds
connection for this Worker, its own Email Sending binding, and the dedicated
`TRACKER_SECRET`, `MAIL_FROM`, `MAIL_TO` Worker secrets. Configure the build's
`TRACKER_URL` and `TRACKER_SECRET` privately. The build may deploy only this
Worker and restore its previous version. Source is ready; production queue and
build activation are separate account operations.

Workers Builds: repository root, deploy command `sh bin/build-tracker`, with
build command empty. The wrapper installs Deno and the pinned npm dependencies.
Watch `workers/tracker`, `packages` and `bin/build-tracker`.

`deploy.ts` hashes the dry-run bundle and skips an unchanged deployment. It
publishes a server-minted canary through the Worker's queue, checks that intake
and grouping produced its bug, and restores the prior deployed version if the
canary is absent after one minute. A first deployment has no prior version; its
failed canary reports that explicitly. No legacy error store is deleted, and yak
reporting/read-path changes are outside this Worker.
