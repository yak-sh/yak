# The kernel Worker

What it is and what every binding is for: `wrangler.toml`. The doors:
`index.ts`.

Deploy is one command, from the repo root:

```sh
deno task deploy:yak   # dev:yak for a local wrangler dev
```

Never `wrangler deploy` by hand. Both tasks go through `wrangler.ts`, which runs
`npm ci` when `node_modules` is behind `package-lock.json` — wrangler bundles
`zod` and the MCP SDK as files out of that directory, and it is gitignored, so a
fresh worktree has none and a bare `wrangler deploy` dies at `mcp.ts`
`import { z } from 'zod'`. `probe.ts` installs through the same door before it
boots a `wrangler dev`.

Correct a deployed regression with `yak revert <sha> --owner`: main is always
deployed. `yak rollback [version] --owner` is for a broken build path and
refuses to cross a data migration boundary. A Durable Object already migrated
keeps its data, even when older code is deployed.

## Workers Builds

A push to `main` deploys, through Cloudflare Workers Builds — not through a
GitHub Actions workflow. Builds clones the repo itself and mints its own API
token, so no Cloudflare credential exists in this repo, on the Actions runner,
or in a GitHub secret.

The dashboard settings, in full (Workers & Pages → `yak` → Settings → Builds):

| setting                 | value                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| Repository              | `yak-sh/yak` (Cloudflare GitHub App)                                         |
| Production branch       | `main`                                                                       |
| Root directory          | `workers/yak`                                                                |
| Build command           | `../../bin/build-yak`                                                        |
| Deploy command          | `../../bin/build-yak deploy`                                                 |
| Build watch paths       | `workers/yak/*`, `packages/*`                                                |
| Non-production branches | build only, no deploy — preview URLs do not apply to a Durable Object Worker |

A push outside the watch paths deploys nothing: no build check, no version, and
so nothing for the gate's `deploy time` step to measure — it says so and the
deploy gate judges the rows already recorded (`bench/deploys.md`).

Everything the build actually does is in `bin/build-yak`, so the dashboard holds
one line: install Deno (not on the Ubuntu 24.04 image), `deno task check` from
the repo root, `deno task test:workers` (kernel and tail). A red build deploys
nothing.

`yak-tail` pages on kernel exceptions and Store/default console errors. Its
incident KV is also the source for `yak errors`; `bin/yak-watch` probes the live
doors and named apps every five minutes from the box. See
[incident paging](../yak-tail/README.md) for the schema, cooldown, cron, and the
separate `deno task deploy:yak-tail` deployment. The tail must exist before the
kernel deploy attaches it through `tail_consumers`.

**Update the dashboard Deploy command to `../../bin/build-yak deploy`.** The
previous `npx wrangler deploy` bypasses the repo's deploy wrapper; changing the
wrapper alone cannot change that dashboard setting. Build and deploy are
separate shell commands, so deploy mode restores Deno's path before it runs
`deno task deploy:yak`. The wrapper passes `--message "<sha> <subject>"` from
`git log -1`, making `annotations["workers/message"]` identify the deployed
commit. `yak deploys --owner` estimates older, unannotated versions from commit
times and marks that estimate in its output.

The owner’s incident commands, using only this box’s Wrangler/GitHub login:

```sh
yak deploys --owner
yak errors --since 10m --owner
yak tail --owner
yak rollback [version] --owner
yak revert <sha> --owner
```

`deploys` joins uploads to deployments and reads each commit’s `BOUNDARIES` from
`migrate.ts` (`MARKS` in older commits). Rollback retains every boundary main
has carried, even after its deployment ages out of Cloudflare’s history. This
conservatively includes failed builds. An inferred commit or incomplete
migration history cannot authorize rollback. `errors` first tries Workers Logs
with Wrangler’s local token; if unavailable it says so and tails the **next**
requested duration, rather than claiming historical coverage. Live tails use the
box’s GNU `timeout` to stop Wrangler and its launcher together.

`revert` requires main to match its remote, gates a fresh worktree, and uses the
same primitive as `task land` to publish. It re-gates after a rebase, checks the
push independently, and waits up to 20 minutes for an annotated version
containing the revert to serve all traffic. A failed worktree is kept for
inspection. Neither a rollback nor a revert undoes migrated data.

Push-to-upload observations, the version-confirmed live timer, the deploy
ratchet, and the build profile are in [deploy timing](../../bench/deploys.md).
Run `deno task deploy:time <sha>` on the box alongside each push; Actions reads
the committed record through `deno task deploy:gate` after worker tests.

## Everything set by hand

A deploy creates nothing on the account and holds no secret. Every piece of
configuration a person does by hand, production and staging alike, is one of
these three tables; each row says where it is set and what is missing without
it. Values never appear here or in the repo.

**Secrets** — `npx wrangler secret put <NAME>` from `workers/yak` (add
`--env staging` for staging); locally a `.dev.vars` line.

| name                                                                                           | required | value                                                                         | without it                                                        |
| ---------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `SESSION_SECRET`                                                                               | yes      | any long random string                                                        | no session verifies, no sign-in code is issued                    |
| `MAIL_TOKEN`, `MAIL_ACCOUNT`                                                                   | yes      | Cloudflare Email Sending API token and the account tag                        | sign-in code letters do not send                                  |
| `CF_ANALYTICS_TOKEN`                                                                           | yes      | API token, **Account · Account Analytics · Read** (see Analytics)             | the meter and Visits report counts are off                        |
| `CF_WORKERS_TOKEN`                                                                             | yes      | API token, **Workers Scripts, D1, R2, Vectorize · Edit** (see App bindings)   | an app's files deploy, its `worker.js` does not                   |
| `CF_HOSTNAMES_TOKEN`                                                                           | domains  | API token, **Zone · SSL and Certificates · Edit** on the zone in `CF_ZONE`    | `domain_attach` refuses, saying so                                |
| `STRIPE_KEY`                                                                                   | billing  | restricted Stripe API key (checkout, portal, one subscription read)           | billing doors say the paid tier is not switched on                |
| `STRIPE_WEBHOOK_SECRET`                                                                        | billing  | `whsec_…` of the **Your account** destination (see the billing section)       | events go unread and are filed where the owner sees them          |
| `STRIPE_CONNECT_WEBHOOK_SECRET`                                                                | selling  | `whsec_…` of the **Connected accounts** destination (see the Connect section) | `POST /stripe/connect` answers 503; selling otherwise works       |
| `MAIL_SINK`                                                                                    | staging  | the owner's address                                                           | staging letters go to their intended recipients                   |
| `OPENAI_APPS_CHALLENGE`                                                                        | optional | the token OpenAI's apps directory issues                                      | `/.well-known/openai-apps-challenge` 404s                         |
| `CIMD`                                                                                         | optional | `on` (default when unset) or `off`                                            | nothing; `off` stops claiming Client ID Metadata Documents        |
| `AI_GATEWAY`, `AI_GATEWAY_TOKEN`, `OPENAI_API_KEY`, `BUILDER_MODEL_FREE`, `BUILDER_MODEL_PAID` | optional | the other builder provider; all unset on purpose (T-34238)                    | nothing; both tiers build on Workers AI                           |
| `MAIL_DEV`                                                                                     | local    | `1`                                                                           | never set on a deploy: letters become entities instead of sending |

**Vars and account resources** — `wrangler.toml` names them; the account must
already hold them (staging: the `[env.staging]` copies, `yak-*-staging` names).

| what                                                                       | where                                                                                    | without it                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `CF_ACCOUNT`, `APEX`, `WORKER_NAME`, `DISPATCH_NAMESPACE`, `VIEWS_DATASET` | `[vars]`; must name the same resources as the bindings                                   | REST calls (app uploads, analytics reads) aim at the wrong place |
| `CF_ZONE`                                                                  | `[vars]`, the zone id of `yaks.app` (staging: `yaks.fyi`, empty until set)               | custom domains refuse provisioning                               |
| `STRIPE_PRICE`                                                             | `[vars]`, the recurring Plus price id (staging: a sandbox price, empty until set)        | checkout has nothing to sell                                     |
| R2 buckets `yak-blobs`, `yak-store-exports`                                | `wrangler r2 bucket create <name>` once                                                  | no app files; a Store with no exports bucket refuses to migrate  |
| Dispatch namespace `yak-apps`                                              | Cloudflare for Platforms, created once (`wrangler dispatch-namespace create yak-apps`)   | apps with a `worker.js` serve their files instead                |
| KV `OAUTH_KV`                                                              | `wrangler kv namespace create` once; paste the id into the binding                       | the OAuth door has no store                                      |
| Vectorize `yak-memories`                                                   | `wrangler vectorize create yak-memories --dimensions=768 --metric=cosine` once           | memory recall ranks by words, not meaning                        |
| Email Sending + Email Routing on the zone                                  | Cloudflare dashboard: onboard the zone, add its issued mail DNS, catch-all → this Worker | no outbound mail from apps, no inbound mail                      |
| DNS `AAAA @ → 100::`, `AAAA * → 100::`, proxied                            | Cloudflare DNS on the zone                                                               | the routes have nothing to attach to                             |
| Custom domains fallback origin + `*/*` route                               | Cloudflare for SaaS on the zone                                                          | a customer's own hostname never reaches the Worker               |
| Workers Builds                                                             | dashboard settings table above                                                           | nothing deploys on push                                          |
| `yak-tail` worker                                                          | `deno task deploy:yak-tail` before the kernel's first deploy                             | the kernel deploy fails attaching `tail_consumers`               |
| Containers                                                                 | Workers Paid with Containers enabled; the deploy builds the image                        | the builder's sandbox tools say so and do not run                |

**Stripe dashboard**, sandbox first, then live:

| step                            | where                                                                                     | without it                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Managed Payments                | Stripe is the merchant of record for the paid tier (billing.ts); enable it on the account | tax and invoicing fall to us                                   |
| Product + recurring price       | Product catalog; the price id is `STRIPE_PRICE`                                           | checkout has nothing to sell                                   |
| Customer portal configuration   | Settings → Billing → Customer portal, save a configuration once                           | the portal door is refused by Stripe, and the refusal is filed |
| Billing webhook, five events    | the billing section below                                                                 | plan changes never land                                        |
| Connect webhook, five v1 events | the Connect section below                                                                 | seller account changes, refunds and disputes go unseen         |

## Staging (yaks.fyi)

`yak-staging` serves `yaks.fyi` and `*.yaks.fyi` with its own stores, app
workers, buckets, memories, OAuth grants and analytics. Staging data is
disposable. The same Workers Builds run on `main` deploys production first, then
staging; a staging failure marks the build red and leaves production deployed.
The individual doors are `deno task deploy:yak-staging`,
`deno task dev:yak-staging`, and `deno task verify:yak --staging`.

Before the first deploy, run `bin/yak-staging-init` on the owner’s box, paste
its OAuth KV id into the staging `OAUTH_KV` binding, and set the listed secrets
through `workers/yak/wrangler.ts` with `--env staging`. Use fresh session
secrets, Stripe sandbox keys, and a sandbox price for `STRIPE_PRICE`. Set
`MAIL_SINK` to the owner’s email address as a **secret**: every outbound letter
goes there, with its intended recipients in the subject. Optional provider
secrets can stay unset. Credentials stay on the box.

Create these Stripe sandbox event destinations, each with its own signing
secret:

| events from                                   | destination                       | secret                          |
| --------------------------------------------- | --------------------------------- | ------------------------------- |
| Your account (the five billing events below)  | `https://yaks.fyi/stripe/webhook` | `STRIPE_WEBHOOK_SECRET`         |
| Connected accounts (the five v1 events below) | `https://yaks.fyi/stripe/connect` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

The zone needs proxied `AAAA @ → 100::` and `AAAA * → 100::` records. Onboard
`yaks.fyi` for Email Sending and Email Routing with Cloudflare’s issued mail DNS
records; route its catch-all to `yak-staging`. Custom domains stay off until
`CF_ZONE` names the `yaks.fyi` zone and its hostname token is set; enabling them
also needs a SaaS fallback origin and a `*/*` route on that zone. Observability
is on; staging has no tail consumer. `yak-watch` reports its apex probe with
`page: false`, excluding its failures from incident paging.

## Migration passes: expand, then contract

A yaks.app version that adds a column or index never removes or re-indexes what
old code depends on in the same version. A version that starts depending on a
new shape ships after the version that created it. Create a unique index over
existing rows inside the pass that prepares them; otherwise skip it with a
report and refuse to serve without the declared constraint.

- Creating an index before its column existed broke directory boot.
- Rollback boot failed on an old vocabulary index the migrated rows violated.

`migrate.ts` lists every stored-shape pass in `BOUNDARIES`, in marker order;
today that is all of `MARKS`. A REFUSED pass is not a boundary: its transaction
rolls back, the data did not move, and its marker stays unchanged. `yak deploys`
still treats a version carrying that pass as a potential boundary, because
another Store may have completed it.

## App bindings

Apps may request D1, R2 and Vectorize resources in `wrangler.jsonc` or
`wrangler.json`. `CF_WORKERS_TOKEN` needs these account permissions: **Workers
Scripts · Edit; D1 · Edit; Workers R2 Storage · Edit; Vectorize · Edit**. The
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
with `yak` (link.ts, identity.ts `/login/link`):

| act    | command                                           |
| ------ | ------------------------------------------------- |
| mint   | `yak test chatgpt-reviewer && yak link --days=90` |
| revoke | `yak link --revoke=<id> --as=chatgpt-reviewer`    |

`yak test <name>` mints `<name>@bot.yak.sh`, signs it in, and makes it current;
`yak link` prints the URL, the id that revokes it, and when it dies (30 days by
asking for nothing, a year at most). Build the account out — an app or two —
before handing the link over, since a reviewer is asked to walk a working
account. `--as` picks the account when it is not the current one.

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

| step | where                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | dashboard.stripe.com → check the account switcher is on the sandbox → **Workbench** → **Webhooks**                                                                            |
| 2    | **Create an event destination**                                                                                                                                               |
| 3    | **Events from**: **Connected accounts** — not "Your account". This is the whole point of the second endpoint                                                                  |
| 4    | Select these five v1 events, and only these: `account.updated`, `account.application.deauthorized`, `checkout.session.completed`, `charge.refunded`, `charge.dispute.created` |
| 5    | **Continue** → destination type **Webhook endpoint** → **Continue**                                                                                                           |
| 6    | Endpoint URL: `https://yaks.app/stripe/connect`                                                                                                                               |
| 7    | On the settings page, **Reveal secret** and copy the `whsec_…` value                                                                                                          |

Then, from `workers/yak`:

```sh
npx wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET   # paste the whsec_
```

**v1 events, not v2.** There is a v2 Accounts API with thin `v2.core.account.*`
events; this platform speaks v1 throughout (Jeff, 2026-09-06: "v1"), so the five
names above are the ones the handler reads. Ticking a v2 spelling is a webhook
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
the deploy, so there is nothing to verify at that point; and the Actions runner
holds no Cloudflare token — Builds mints its own — so `wrangler tail`, the half
that actually catches a 5xx, cannot run there. A gate-side check would also race
the Builds deploy and verify whichever version happened to be live, which is a
green that means nothing. So it stays one command, run after a Builds deploy
goes green. `--tail 0` skips the tail and needs no credential at all.
