# The kernel Worker

What it is and what every binding is for: `wrangler.toml`. The doors:
`index.ts`.

Deploy is one command, from the repo root:

```sh
deno task deploy:yak   # dev:yak for a local wrangler dev
```

A deploy of the kernel deploys its sibling Workers first, from the same commit
and to the same environment: `yak-out` (`outbound/`, the dispatch namespace's
outbound Worker) and `yak-esbuild` (`esbuild/`, the compiler `app_deploy` asks
for an app's TypeScript and npm imports, @yaks/esbuild). `yak-esbuild` is a
Worker in front of a container running native esbuild; its image is
`esbuild/Dockerfile` over `packages/esbuild`, and its deploy builds and pushes
the image like the kernel's sandbox. The siblings do not call one another, so
their deploys run concurrently with the kernel bundle and sandbox base
preparation. Both must finish successfully before the kernel upload begins; a
failure waits for the other work and refuses the kernel upload. The pinned
Wrangler bundles once, including node compatibility code and source maps; the
upload reads those generated modules without bundling again.

Never `wrangler deploy` by hand. Both tasks go through `wrangler.ts`, which runs
`npm ci` when `node_modules` is behind `package-lock.json` — wrangler bundles
`zod` and the MCP SDK as files out of that directory, and it is gitignored, so a
fresh worktree has none and a bare `wrangler deploy` dies at `mcp.ts`
`import { z } from 'zod'`. The test probes (probe-suite.ts) install through the
same door before they bundle the kernel.

Correct a deployed regression with `yak admin revert <sha>`: main is always
deployed. `yak admin rollback [version]` is for a broken build path and refuses
to cross a data migration boundary. A Durable Object already migrated keeps its
data, even when older code is deployed.

## Workers Builds

A push to `main` deploys, through Cloudflare Workers Builds — not through a
GitHub Actions workflow. Builds clones the repo itself and mints its own API
token, so no Cloudflare credential that can deploy exists in this repo, on the
Actions runner, or in a GitHub secret. The runner holds one read-only token
(Workers Scripts Read), so the gate can time the deploy.

Nothing gates that push. `.github/workflows/gate.yml` runs `deno task check` and
`deno task test`, the workerd tests included, and it reports what it finds: a
red test is a bug to fix, not a deploy held back. T-37197 briefly promoted a
gated `deploy` branch instead; it was reverted the same day (M-37262).

The dashboard settings, in full (Workers & Pages → `yak` → Settings → Builds):

| setting                 | value                                    |
| ----------------------- | ---------------------------------------- |
| Repository              | `yak-sh/yak` (Cloudflare GitHub App)     |
| Production branch       | `main`                                   |
| Root directory          | `workers/yak`                            |
| Build variable          | `SKIP_DEPENDENCY_INSTALL=1`              |
| Build command           | (empty)                                  |
| Deploy command          | `../../bin/build-yak deploy`             |
| Build watch paths       | `workers/yak/*`, `packages/*`            |
| Non-production branches | build only; previews off for now (below) |

Worker Previews give a branch its own URL, and since Cloudflare's 2026-09-22
launch each preview gets its own Durable Object namespace
(https://developers.cloudflare.com/workers/previews/). They are off for now.
Turning them on for `yak` means a `previews` block in wrangler.toml and
`npx wrangler preview` (Wrangler 4.135 or later), and these hold for us: D1, R2
and KV bind by id, so a preview shares production's rows and objects unless it
names its own; service bindings call the production Worker; queue consumers and
cron triggers stay on production, so no job or build alert runs in a preview;
and a preview is one hostname, while yaks.app serves each space at
`<space>.<APEX>`, so spaces need a wildcard below the preview's hostname.

A push outside the watch paths deploys nothing: no build check, no version, and
so nothing for the gate's `deploy time` step to measure — it says so and the
deploy gate judges the rows already recorded (`bench/deploys.md`).

Catalog transpilation is reused from the restored Deno cache between builds.

The build command is empty, so a Workers Build runs neither `deno task check`
nor the tests. `SKIP_DEPENDENCY_INSTALL=1` disables Builds' automatic install
([build image variables](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)).
`bin/build-yak deploy` keeps Deno and the installed npm project under npm's
restored cache directory, linking the checkout's `node_modules` to that tree.
Each package manifest, lockfile and platform has its own project. It runs
`npm ci` only when the installed `node_modules/.package-lock.json` differs from
`package-lock.json` or installed packages are missing. Restored matching
packages are reused regardless of file timestamps. An empty cache installs
normally; with the variable unset, Builds' automatic install seeds the cache. It
prepares the kernel and sibling bundles while making the deploy pre-flight check
(`superseded`). After the guard permits deployment, sandbox base preparation and
each changed sibling's upload run as their own preparation allows. The kernel
uploads after all succeed. Each sibling is bundled locally and compared with its
fully serving deployment's `inputs:<sha256>` annotation. The digest covers every
upload module, the inputs of each container image the sibling runs (its
Dockerfile and every file of its build context, `wrangler.ts` `images`), its
configuration, Wrangler pin and environment. A matching sibling stays serving
without another upload; changed inputs, an unreadable deployment or a release
without the annotation upload normally. The compiler image has its own
`inputs:<sha256>` registry tag, covering its Dockerfile and build context. A
changed Worker or toolkit catalog reuses that image; only a missing image tag
builds and pushes it. The sibling upload uses a temporary config beside the
original, naming the registry image, so Wrangler rolls it out without rebuilding
it. Registry, build or push failures refuse the sibling and kernel deploy.
Workers Builds has Docker, as the sandbox image already needs. `bin/build-yak`
with no argument still runs the check and the workers tests by hand. A push's
build that fails is started once more through the `BUILD_HOOK` deploy hook
(builds.ts), since most failures are the network's; the second build's failure
stands.

Builds run on watched-path pushes and finish in any order, so the deploy door
(`wrangler.ts` `superseded`) deploys a commit only while no later commit changes
the watched source and no live version is ahead of it. An app-only push starts
no replacement build and does not supersede the last one. A build that loses the
race to newer Worker source deploys nothing and says why in its log.

The sandbox tools use the Cloudflare provider in
[@yaks/machine](../../packages/machine/README.md#cloudflare-containers).
`sandbox.ts` checks allowances, supplies the caller's scoped grant, and counts
container seconds; the provider owns container RPCs and lifecycle. Grants and
the meter remain platform concerns.

The sandbox image is two halves (sandbox/base.ts). `sandbox/base/Dockerfile` is
the toolchain, pushed to the registry once per version of that file as
`yak-sandbox:base-<its hash>`; `sandbox/Dockerfile` builds FROM that tag and
adds the `yak` CLI, so a push to main pushes only the CLI's layers. To change a
toolchain, edit the base file and set the FROM tag `sandbox_test.ts` names; the
next deploy builds and pushes the base before its own image.

## Store traces

Store requests are recorded in memory. Only requests reading or writing more
than 10,000 SQL rows, requested captures, and ordinary samples are delivered to
`yak-errors`; an unselected request performs no additional SQL or delivery. An
automatic over-the-line capture is admitted at most once per operation and name
per rolling hour in each Store incarnation. Suppressed repeats are counted in
memory and carried as `repeats{n}` on the next delivered root span. Requested
and sampled captures retain their independent N and rate bounds. The quota
resets on eviction and is never stored in app rows. Errors remain on Sentry. The
independent [tracker](../tracker/README.md) stores the trace and its separately
addressed spans and metric components.

A platform admin can arm a capture without generating app traffic:

```sh
yak store_trace --space yourname --app notes --next 3 --rate 0.001
```

`next` is 0..100 and `rate` is the probability of retaining an ordinary request.
Both apply to the current Store incarnation and reset on eviction. The reply
reports whether the queue producer is available. The control request is not a
sample and does not consume `next`; HTTP, socket messages, and alarms do.
Ordinary sampling defaults to zero until its rate is set. The Store learns a
space's global eid from explicit kernel setup/control so alarms can route to
that tracker without polling the directory. A pre-existing Store without that
scope needs explicit setup/control before an alarm capture can be delivered.

The locus provisions `yak-errors` and deploys the tracker; the producer binding
is prepared as a commented stanza in `wrangler.toml`; activation uncomments it
after the queue and tracker exist. Without the binding, records are discarded
rather than writing into the app Store. Each delivered chunk carries
`during.space` on every entity, and immutable ids make queue redelivery safe.
The request's span counts close before delivery and do not include delivery.

Defects go to Sentry (org `yaks`, project `yaks-app`; sentry.ts): an exception
nothing caught, a break the router or a job files, a Store's own, a connector
tool's, any `console.error`, and a Workers Build that failed (builds.ts, fed by
the `yak-builds` queue's event subscription). Each carries its tags (`tool`,
`space`, `app`, `client`, `store`, `request`) and the person's eid as the user
with `account` set to `person` or `test` (a test account, lib/bots.ts). The
release is the Workers version id and the environment is `SENTRY_ENVIRONMENT`
(`production`, `staging`). A refusal is never sent. With no `SENTRY_DSN` secret
nothing is sent, which is what keeps the tests and `wrangler dev` silent. Source
maps are not uploaded; the bundle is not minified, so a stack names our
functions. To prove a deploy's defects arrive, a test account POSTs
`/api/defect` at the apex: that is a defect tagged `tool:canary`, `account:test`
(mcp.ts `canary`).

Sentry's one active uptime monitor (https://yaks.sentry.io/monitors/10414356/)
GETs https://yourname.yaks.app/recipes/api/query?.recipe&.limit=1 every minute
and is the one alarm for an outage: it reaches the kernel, the directory and an
app's store, so each check also costs that store's rows.

**Update the dashboard Deploy command to `../../bin/build-yak deploy`.** The
previous `npx wrangler deploy` bypasses the repo's deploy wrapper; changing the
wrapper alone cannot change that dashboard setting. Build and deploy are
separate shell commands, so deploy mode restores Deno's path before it runs
`deno task deploy:yak`. The wrapper passes `--message "<sha> <subject>"` from
`git log -1`, making `annotations["workers/message"]` identify the deployed
commit. `yak admin deploys` estimates older, unannotated versions from commit
times and marks that estimate in its output.

The incident commands, using this box’s Wrangler/GitHub login. `--as` names the
yaks.app account the act is recorded under; without it the act is the configured
person’s own. An agent acts as the platform’s admin person (`admin@bot.yak.sh`,
seeded into the directory), so the owner’s name stays on what he did himself.

```sh
yak admin deploys --as admin@bot.yak.sh
yak admin errors --since 10m --as admin@bot.yak.sh
yak admin tail --as admin@bot.yak.sh
yak admin rollback [version] --as admin@bot.yak.sh
yak admin revert <sha> --as admin@bot.yak.sh
yak admin move --rehearse --as admin@bot.yak.sh  # every store rehearses the mover's rules
```

An account’s credential is a connection in the CLI’s graph, never a token file;
`yak auth --as <account>` signs one in without a browser.

`deploys` joins uploads to deployments and reads each commit’s `BOUNDARIES` from
`migrate.ts` (`MARKS` in older commits). Rollback retains every boundary main
has carried, even after its deployment ages out of Cloudflare’s history. This
conservatively includes failed builds. An inferred commit or incomplete
migration history cannot authorize rollback. `errors` reads the preceding window
from Sentry, the one record of every failure the platform throws or catches
(sentry.ts), one line per issue. It reads with a Sentry token that can read the
org (`org:read`), kept in this box’s vault as `sentry`, an `op://` reference,
and refuses with the line that keeps one when there is none. `tail` watches live
traffic, using the box’s GNU `timeout` to stop Wrangler and its launcher
together.

`revert` requires main to match its remote, gates a fresh worktree, and uses the
same primitive as `task land` to publish. It re-gates after a rebase, checks the
push independently, and waits up to 20 minutes for an annotated version
containing the revert to serve all traffic. A failed worktree is kept for
inspection. Neither a rollback nor a revert undoes migrated data.

Push-to-upload observations, the version-confirmed live timer, the deploy
ratchet, and the build profile are in [deploy timing](../../bench/deploys.md).
The gate runs `deno task deploy:time <sha>` first on each push to main, and
reads the committed record through `deno task deploy:gate` after the tests.

## Everything set by hand

A deploy creates nothing on the account and holds no secret. Every piece of
configuration a person does by hand, production and staging alike, is one of
these three tables; each row says where it is set and what is missing without
it. Values never appear here or in the repo.

**Secrets** — `npx wrangler secret put <NAME>` from `workers/yak` (add
`--env staging` for staging); locally a `.dev.vars` line.

| name                                                                                           | required | value                                                                                                                              | without it                                                                                    |
| ---------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                                                               | yes      | any long random string                                                                                                             | no session verifies, no sign-in code is issued                                                |
| `MAIL_TOKEN`, `MAIL_ACCOUNT`                                                                   | yes      | Cloudflare Email Sending API token and the account tag                                                                             | sign-in code letters do not send                                                              |
| `CF_ANALYTICS_TOKEN`                                                                           | yes      | API token, **Account · Account Analytics · Read** (see Analytics)                                                                  | the meter and Visits report counts are off                                                    |
| `CF_WORKERS_TOKEN`                                                                             | yes      | API token, **Workers Scripts, D1, R2, Vectorize · Edit; Connectivity Directory · Bind** (see App bindings)                         | an app's files deploy, its `worker.js` does not; no space gets a tunnel                       |
| `BUILD_HOOK`                                                                                   | prod     | deploy hook URL for `main` (Workers & Pages → `yak` → Settings → Builds)                                                           | a failed push build is filed, never built again                                               |
| `BUILD_LOG_TOKEN`                                                                              | prod     | user-scoped Cloudflare API token with **Workers CI · Read** on this account                                                        | the failed-build report links to its log but has no step or error summary                     |
| `CF_TUNNEL_TOKEN`                                                                              | tunnels  | API token, **Cloudflare Tunnel · Edit; Connectivity Directory · Admin**                                                            | connect answers 503, and so do rotate and disconnect on a pair the platform made; adopt works |
| `CF_HOSTNAMES_TOKEN`                                                                           | domains  | API token, **Zone · SSL and Certificates · Edit** on the zone in `CF_ZONE`                                                         | `domain_attach` refuses, saying so                                                            |
| `REALTIME_APP`, `REALTIME_TOKEN`, `TURN_KEY`, `TURN_TOKEN`                                     | voice    | the platform's one Cloudflare Realtime SFU app id and secret, and its one TURN key id and token (1Password, "yaks.app Realtime …") | every app's `./api/rtc/` answers 503 `voice_off`                                              |
| `STRIPE_KEY`                                                                                   | billing  | restricted Stripe API key (checkout, portal, one subscription read)                                                                | billing doors say the paid tier is not switched on                                            |
| `STRIPE_WEBHOOK_SECRET`                                                                        | billing  | `whsec_…` of the **Your account** destination (see the billing section)                                                            | events go unread and are filed where the owner sees them                                      |
| `STRIPE_CONNECT_WEBHOOK_SECRET`                                                                | selling  | `whsec_…` of the **Connected accounts** destination (see the Connect section)                                                      | `POST /stripe/connect` answers 503; selling otherwise works                                   |
| `VAULT_KEY`                                                                                    | yes      | 32 random bytes in base64 (`openssl rand -base64 32`); never changed                                                               | the connections page says keys cannot be saved here                                           |
| `SENTRY_DSN`                                                                                   | yes      | the `yaks-app` project's DSN (Sentry → Settings → Client Keys)                                                                     | no defect reaches Sentry                                                                      |
| `MAIL_SINK`                                                                                    | staging  | the owner's address                                                                                                                | staging letters go to their intended recipients                                               |
| `OPENAI_APPS_CHALLENGE`                                                                        | optional | the token OpenAI's apps directory issues                                                                                           | `/.well-known/openai-apps-challenge` 404s                                                     |
| `CIMD`                                                                                         | optional | `on` (default when unset) or `off`                                                                                                 | nothing; `off` stops claiming Client ID Metadata Documents                                    |
| `AI_GATEWAY`, `AI_GATEWAY_TOKEN`, `OPENAI_API_KEY`, `BUILDER_MODEL_FREE`, `BUILDER_MODEL_PAID` | optional | the other builder provider; all unset on purpose (T-34238)                                                                         | nothing; both tiers build on Workers AI                                                       |
| `MAIL_DEV`                                                                                     | local    | `1`                                                                                                                                | never set on a deploy: letters become entities instead of sending                             |

**Vars and account resources** — `wrangler.toml` names them; the account must
already hold them (staging: the `[env.staging]` copies, `yak-*-staging` names).

| what                                                                       | where                                                                                    | without it                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `CF_ACCOUNT`, `APEX`, `WORKER_NAME`, `DISPATCH_NAMESPACE`, `VIEWS_DATASET` | `[vars]`; must name the same resources as the bindings                                   | REST calls (app uploads, analytics reads) aim at the wrong place |
| `CF_ZONE`                                                                  | `[vars]`, the zone id of `yaks.app` (staging: `yaks.fyi`, empty until set)               | custom domains refuse provisioning                               |
| `STRIPE_PRICE`                                                             | `[vars]`, the recurring Plus price id (staging: the sandbox price the probes buy)        | checkout has nothing to sell                                     |
| R2 bucket `yak-blobs`                                                      | `wrangler r2 bucket create <name>` once                                                  | no app files                                                     |
| Dispatch namespace `yak-apps`                                              | Cloudflare for Platforms, created once (`wrangler dispatch-namespace create yak-apps`)   | apps with a `worker.js` serve their files instead                |
| KV `OAUTH_KV`                                                              | `wrangler kv namespace create` once; paste the id into the binding                       | the OAuth door has no store                                      |
| D1 `yak-vault` (staging `yak-vault-staging`)                               | created once; its id is in the `VAULT` binding                                           | no connection's key can be saved                                 |
| Email Sending + Email Routing on the zone                                  | Cloudflare dashboard: onboard the zone, add its issued mail DNS, catch-all → this Worker | no outbound mail from apps, no inbound mail                      |
| DNS `AAAA @ → 100::`, `AAAA * → 100::`, proxied                            | Cloudflare DNS on the zone                                                               | the routes have nothing to attach to                             |
| Custom domains fallback origin + `*/*` route                               | Cloudflare for SaaS on the zone                                                          | a customer's own hostname never reaches the Worker               |
| Workers Builds                                                             | dashboard settings table above                                                           | nothing deploys on push                                          |
| Containers                                                                 | Workers Paid with Containers enabled; the deploy builds the image                        | the builder's sandbox tools say so and do not run                |

**Stripe dashboard**, sandbox first, then live:

| step                           | where                                                                                     | without it                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Managed Payments               | Stripe is the merchant of record for the paid tier (billing.ts); enable it on the account | tax and invoicing fall to us                                   |
| Product + recurring price      | Product catalog; the price id is `STRIPE_PRICE`                                           | checkout has nothing to sell                                   |
| Customer portal configuration  | Settings → Billing → Customer portal, save a configuration once                           | the portal door is refused by Stripe, and the refusal is filed |
| Billing webhook, five events   | the billing section below                                                                 | plan changes never land                                        |
| Connect webhook, six v1 events | the Connect section below                                                                 | seller account changes, refunds and disputes go unseen         |

## Staging (yaks.fyi)

Staging exists to test billing against Stripe's sandbox. `yak-staging` serves
`yaks.fyi` and `*.yaks.fyi` with its own stores, app workers, buckets, memories,
OAuth grants and analytics. Staging data is disposable. The same Workers Builds
run on `main` deploys production first, then staging; a staging failure marks
the build red and leaves production deployed. The individual doors are
`deno task deploy:yak-staging`, `deno task dev:yak-staging`, and
`deno task verify:yak --staging`.

Before the first deploy, run `bin/yak-staging-init` on the owner’s box, paste
its OAuth KV id into the staging `OAUTH_KV` binding, and set the listed secrets
through `workers/yak/wrangler.ts` with `--env staging`. Use fresh session
secrets, Stripe sandbox keys, and a sandbox price for `STRIPE_PRICE`. Set
`MAIL_SINK` to the owner’s email address as a **secret**: every outbound letter
goes there, with its intended recipients in the subject. Optional provider
secrets can stay unset. Credentials stay on the box.

Create these Stripe sandbox event destinations, each with its own signing
secret:

| events from                                  | destination                       | secret                          |
| -------------------------------------------- | --------------------------------- | ------------------------------- |
| Your account (the five billing events below) | `https://yaks.fyi/stripe/webhook` | `STRIPE_WEBHOOK_SECRET`         |
| Connected accounts (the six v1 events below) | `https://yaks.fyi/stripe/connect` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

The zone needs proxied `AAAA @ → 100::` and `AAAA * → 100::` records. Onboard
`yaks.fyi` for Email Sending and Email Routing with Cloudflare’s issued mail DNS
records; route its catch-all to `yak-staging`. Custom domains stay off until
`CF_ZONE` names the `yaks.fyi` zone and its hostname token is set; enabling them
also needs a SaaS fallback origin and a `*/*` route on that zone. Observability
is on; staging has no tail consumer.

## Migration passes: expand, then contract

A yaks.app version that adds a column or index never removes or re-indexes what
old code depends on in the same version. A version that starts depending on a
new shape ships after the version that created it. Create a unique index over
existing rows inside the pass that prepares them; if no row has a complete key,
the new index can be created as empty. Otherwise skip it with a report and
refuse to serve without the declared constraint.

- Creating an index before its column existed broke directory boot.
- Rollback boot failed on an old vocabulary index the migrated rows violated.

`migrate.ts` lists every stored-shape pass in `BOUNDARIES`, in marker order; a
pass that writes only columns the build before it already reads is not one. A
pass deleted once it has run everywhere keeps its name in the list, because the
code after it still reads the shape it made. A refused pass is not a boundary
either: its transaction rolls back, the data did not move, and its marker stays
unchanged. `yak admin deploys` still treats a version carrying that pass as a
potential boundary, because another Store may have completed it.

Rows move with the store mover (mover.ts, D-45640), never inside boot. A Store
moves from its alarm once it serves, one transaction of fifty rows at a time,
yielding between them; a batch that fails unwinds and is reported, and the store
keeps serving the shape it holds until its next incarnation tries again. A rule
is data, the rows still in the old shape and the patch that moves one, and lands
rehearsal-only: `yak admin move --rehearse` moves every rule's rows in every
store inside a transaction the store rolls back, up to twenty batches, and says
what each found and moved, any failure, and how long each store took to answer.
A clean rule goes `live: 'apps'`, then `'all'`, the directory last, and its mark
joins `BOUNDARIES` in that release. `yak admin move` wakes the dormant stores a
few a minute and says where each rule stands in each.

An app's declared lens also supplies its mover rule. Its expanded vocabulary
holds source columns only while they hold values. The final batch drops empty
translated app properties and columns in the same transaction as its stamp;
rehearsal rolls those schema changes back too. The store retains its newest
vocabulary and immutable lens history when app code rolls back. A kept page's
deploy selects its `$speaks` for writes, dry runs, streamed imports, reads,
subscriptions and vocabulary declarations, including composed app/home access.
Core platform columns remain owned by the platform's vocabulary.

## App bindings

Apps may request D1, R2 and Vectorize resources in `wrangler.jsonc` or
`wrangler.json`. `CF_WORKERS_TOKEN` needs these account permissions: **Workers
Scripts · Edit; D1 · Edit; Workers R2 Storage · Edit; Vectorize · Edit;
Connectivity Directory · Bind**, the last for the gateway of a space's tunnel to
a machine (tunnel.ts), which is the only script bound to its VPC Service. The
token stays a Worker secret. Resources follow the app's immutable store handle
through renames; config removal unbinds them and permanent app erasure deletes
them. The ordinary 30-day trash keeps them for restoration.

Vectorize creation takes `dimensions` and `metric`, or `preset`, on its binding
entry; these extend Wrangler's binding configuration because a new index needs
an explicit shape. Durable Object migrations retain their declarations and are
sent as pending steps after the deployed script's migration tag. A rollback that
omits that tag refuses the worker upload instead of replaying migrations.

R2 erasure lists and deletes objects before deleting the bucket. An object key
with a `.` or `..` path segment cannot be addressed by the REST delete route:
the URL parser normalizes it. That erasure retains its directory record and
reports the bucket to empty in the R2 dashboard before retrying.

## Analytics

`CF_ANALYTICS_TOKEN` reads both usage metrics and page visits. It needs
**Account · Account Analytics · Read** for the account in `CF_ACCOUNT`. The
existing usage token serves both APIs; no separate Visits secret is needed.

To configure a new deployment, create that scoped token in Cloudflare's **API
Tokens** settings, then from `workers/yak`:

```sh
npx wrangler secret put CF_ANALYTICS_TOKEN
```

Page views are collected through the `VIEWS` binding independently of this
reader. Without the token, Visits and `app_stats` report that counts are off.

## A reviewer's sign-in link

An app directory's reviewer gets a link, never a mailbox: OpenAI rejects
credentials behind an email code, and Anthropic asks for a fully populated test
account (T-34351). A standing link signs its holder in until it expires and is
worth a session and nothing more — so it is minted by the account it signs in,
with `yak admin` (link.ts, identity.ts `/login/link`):

| act    | command                                                                                  |
| ------ | ---------------------------------------------------------------------------------------- |
| mint   | `yak admin throwaway chatgpt-reviewer && yak admin link --days=90 --as=chatgpt-reviewer` |
| revoke | `yak admin link --revoke=<id> --as=chatgpt-reviewer`                                     |

`yak admin throwaway <name>` mints `<name>@bot.yak.sh` and signs it in, leaving
the box's current account as it was; `--as` names it on each command after.
`yak admin link` prints the URL, the id that revokes it, and when it dies (30
days by asking for nothing, a year at most). Build the account out — an app or
two — before handing the link over, since a reviewer is asked to walk a working
account.

## STRIPE_WEBHOOK_SECRET — the billing door's events

billing.ts is the platform's own plan: Stripe sells to us, and tells us at
`POST /stripe/webhook`. The handler reads five v1 events and nothing else
(billing.ts `subjectOf`); the dashboard steps are the Connect ones below with
these differences:

| step | where                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | **Events from**: **Your account**                                                                                                                                                     |
| 4    | Select these five v1 events, and only these: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` |
| 6    | Endpoint URL: `https://yaks.app/stripe/webhook`                                                                                                                                       |
| 8    | `npx wrangler secret put STRIPE_WEBHOOK_SECRET`                                                                                                                                       |

## STRIPE_CONNECT_WEBHOOK_SECRET — the selling door's own secret

Selling (sell.ts) is a **second** Stripe relationship, not an extension of the
first. billing.ts is the platform's own plan, where Stripe sells to us; this is
Connect, where a space's own Stripe account sells to its customers and we take a
fee on the way past. Stripe delivers **connected-account** events to their own
endpoint with their own signing secret, so there are two `whsec_…` and neither
verifies the other's events.

The platform API key is the **same** one — a direct charge is our key acting on
the merchant's account through a `Stripe-Account` header, never a key of theirs
— so `STRIPE_KEY` needs nothing done to it.

Until the secret is set, `POST /stripe/connect` answers 503 in one sentence and
everything else still works: a space connects, a checkout session is created, a
buyer pays. What is missing is only what the events would have told us.

The dashboard steps, in full. In the **sandbox** first, then again in live:

| step | where                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | dashboard.stripe.com → check the account switcher is on the sandbox → **Workbench** → **Webhooks**                                                                                                    |
| 2    | **Create an event destination**                                                                                                                                                                       |
| 3    | **Events from**: **Connected accounts** — not "Your account". This is the whole point of the second endpoint                                                                                          |
| 4    | Select these six v1 events, and only these: `account.updated`, `account.application.deauthorized`, `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` |
| 5    | **Continue** → destination type **Webhook endpoint** → **Continue**                                                                                                                                   |
| 6    | Endpoint URL: `https://yaks.app/stripe/connect`                                                                                                                                                       |
| 7    | On the settings page, **Reveal secret** and copy the `whsec_…` value                                                                                                                                  |

Then, from `workers/yak`:

```sh
npx wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET   # paste the whsec_
```

**v1 events, not v2.** There is a v2 Accounts API with thin `v2.core.account.*`
events; this platform speaks v1 throughout (Jeff, 2026-09-06: "v1"), so the five
names above are the ones the handler reads. Ticking a v2 event name is a webhook
that delivers and does nothing.

**No account-created event.** We create the account ourselves and write its id
down in the same breath (sell.ts `connect`), so there is nothing to be told.

## Verifying a deploy

```sh
deno task verify:yak
```

`bin/verify-deploy.ts`: the seven public doors, the connector's one anonymous
tool, and three minutes of `wrangler tail` with zero 5xx — what was done by hand
after the last two deploys (T-33808, T-34085).

It is **not** wired into CI, on purpose. Builds runs the build command _before_
the deploy, so there is nothing to verify at that point; and the Actions
runner's one Cloudflare token only reads versions — Builds mints its own — so
`wrangler tail`, the half that actually catches a 5xx, cannot run there. A
gate-side check would also race the Builds deploy and verify whichever version
happened to be live, which is a green that means nothing. So it stays one
command, run after a Builds deploy goes green. `--tail 0` skips the tail and
needs no credential at all.

## App archetype indexing

Hosted app stores include the `archetype` vocabulary and tracker. Each entity's
`entity.archetype` references a canonical set of component tables. The SQL
reader uses these sets for presence predicates and to gather only the component
tables present in a result. Value predicates still use their normal column
indexes. Descriptors are readable but not writable by app clients; app manifests
cannot redeclare `archetype` or `retired`. The platform directory and Git stores
do not opt into this rollout.

The existing Durable Object schema fingerprint triggers a transactional backfill
on first wake after deployment. Backfill groups incomplete entities by physical
component set; it is not repeated on every request. The same installer handles
new apps and vocabulary changes. Cloudflare-owned internal tables are excluded.
If installation fails, the existing schema-refusal path prevents serving a
partially initialized store. An app that already used a newly reserved component
name needs explicit migration; its data is not silently reinterpreted.

The hourly usage request reads Cloudflare analytics and R2, not app stores.
Platform deployment does not visit app databases. Until an app wakes, its old
rows have not been backfilled. These changes use the Durable Object
transaction/request barrier, not the local harness's migration-announcement
polling. Do not run older writers against an upgraded store: they do not
maintain the derived pointers. Rebuilding all pointers is an explicit repair,
not a reason to change their values through the app API.

An isolated benchmark is available with
`deno run -A workers/yak/archetype_bench.ts`. In one run with 2,000 entities
spread across 40 sparse component tables, 50 reads returning 25 entities took 48
ms without tracking and 25 ms with it; SQL statements per read dropped from 13
to 5. Seeding writes increased from 192 ms to 252 ms and backfill took 22 ms.
This is not a production latency guarantee: savings depend on sparsity/query
projection, and writes and descriptor storage have a cost. One large app still
pays a synchronous first-wake backfill; large-data Cloudflare CPU limits need
monitoring.

## Store archetypes

User apps, the platform directory, and the Git object store compose the same
read-only archetype vocabulary and tracker. Each retains its own domain
vocabulary; enabling classification does not give Git objects app components or
make the platform directory a user app. The HTTP authorization paths are
unchanged.

The existing schema-fingerprint initialization barrier installs the tables and
backfills physical component membership in the same transaction. It runs once
when that fingerprint changes, not on each read. Git object insertion and
directory writes already go through the graph; no separate SQL writer was
introduced. Git object IDs and external content hashes are unchanged.

Existing stores upgrade on their next request. The directory is normally active;
the Git store wakes when deploy/history/clone operations use it. The hourly app
usage sweep is not a guarantee that the Git store has woken. Dormant stores are
not all migrated when code is deployed. Backfill is synchronous; a large store
will pay its initial migration cost before serving that request.

Run `deno run -A workers/yak/platform_archetype_bench.ts` for an isolated,
repeatable comparison (`BENCH_ROWS=20000` selects a larger fixture). With 20,000
entities and fifty 25-row reads, one local run measured:

| Store     | Statements/read before → after | Fifty reads before → after | Seed writes before → after | Backfill |
| --------- | ------------------------------ | -------------------------- | -------------------------- | -------- |
| Directory | 20 → 7                         | 47 → 27 ms                 | 3.50 → 4.26 s              | 172 ms   |
| Git blobs | 9 → 7                          | 23 → 34 ms                 | 4.42 → 5.55 s              | 218 ms   |

The rollout adds an `(archetype, num)` index: without it, SQLite sorted every
matching entity before applying the default page limit, and the homogeneous Git
fixture took 352 ms for those fifty reads. The index removes that scaling
regression. Classification still adds descriptor work: narrow, homogeneous
stores are not guaranteed a speedup. These are local adapter measurements, not
production latency promises. Git gains the shared metadata and fewer table
probes, not a claimed latency improvement for this workload.

## License

yaks.app, this directory, is under the Functional Source License, FSL-1.1-ALv2
(`LICENSE.md`), from 2026-09-22 forward: each version becomes Apache-2.0 two
years after its release. The rest of the repo is Apache-2.0 (the root
`LICENSE`).

### App-scoped graph web page

`/<app>/_web` serves @yaks/web against that app's store. This reserved door
requires a signed-in space member/owner (not a public visitor or an app-only
guest); assets and identity use the same check. Refusals are the app API's JSON
envelope. The page declares `/<app>/api` for its wire and uses the signed-in
person as the Inbox target. `/<app>/api/vocab` answers the shared docs+keywords
wire, including borrowed docs; the Store's internal `/vocab` remains the app's
manifest. The ordinary `/api/query` serves archetype rows and tallies already.
The Inspect link opens `/<app>/_web/inspect`, the inspector over the same store
and signed-in account. Its entity and query addresses stay under that mount;
reads, writes and subscriptions use `/<app>/api`.

Deployment preparation builds the package assets into ignored `public/_web`,
including the inspector in `public/_web/inspect`.

### Remote terminal inspector

`yak inspect --app <slug>` (or `--app <space>/<slug>`) resolves the app at
`GET /api/app?app=…`, then reads its ordinary `/<app>/api` wire using the
caller's saved account credential, including the socket handshake. Members and
owners keep the app's own access; invalid credentials and cross-space narrowed
grants are refused in the app's JSON envelope. No option keeps the local
inspector unchanged.

App stores compose @yaks/vocab's schema entities, without the journal.
Component/property pages use ordinary queries, answered from the vocabulary the
store is served with (@yaks/code `describing`): a deploy writes no description
row, so a first deploy costs the app's own rows, not a copy of the platform's
words. A query naming a description component or entity reads past the rows
stores described before, which stay standing, unread: deleting them would incur
billed writes. A query naming neither, a census or a search, counts and finds
only what the store holds. The platform's own two stores still describe theirs
in rows, in bounded writes with the hash last, since the directory's journal
names a change's component by its row. Schema changes retain unchanged FTS
indexes and writers. Classification audits are explicit repairs, not release
installation work. The inspector omits history when its vocabulary has no
`_change`. Standing journal tables and their rows are left untouched: removing
them would incur billed writes. Schema rows are excluded from ordinary page
listings unless named explicitly, like other platform-owned rows.
