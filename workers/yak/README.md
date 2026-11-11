# The kernel Worker

What it is and what every binding is for: `wrangler.toml`. The doors:
`index.ts`.

Deploy is one command, from the repo root:

```sh
deno task deploy:yak   # dev:yak for a local wrangler dev
```

`deno task dev:yak` and `deno task dev:yak-staging` set `LOCAL_DEV=1`, which
allows `x-yak-host` to select a hostname on loopback requests. A direct
`wrangler dev` needs `--var LOCAL_DEV:1` to enable the same local override.
Deployed requests ignore the header. Production and staging disable both
workers.dev routes and preview URLs; callers use the zone or service bindings. A
local dev run is composed as yaks.app is: `yak-front` takes the port and the
kernel runs behind it (wrangler.ts `fronted`), so the apex's `/_cli/` answers
from front's assets there too.

yaks.app's routes belong to `yak-front` (`front/`), not to this Worker: it
answers what Site's cache holds and hands everything else to the kernel's
default entrypoint over a service binding. Its upload is what a cold request to
it pays for, so what it imports stays free of the graph stack. Moving a route
takes an API call on the route, since Wrangler refuses one held by another
Worker.

A deploy of the kernel deploys its sibling Workers from the same commit and to
the same environment: `yak-front`, `yak-out` (`outbound/`, the dispatch
namespace's outbound Worker), `yak-esbuild` (`esbuild/`, the compiler
`app_deploy` asks for an app's TypeScript and npm imports, @yaks/esbuild),
`yak-raster` (`raster/`, which draws an app's `icon.svg` as its `icon.png` with
resvg's WebAssembly, kept out of the kernel so no Store's isolate compiles it)
`yak-browser` (`browser/`, which renders a draft for `app_preview` with
puppeteer and checks it with axe-core, kept out of the kernel for the same
reason) and `yak-sandbox` (`sandbox/`, the Workbench Durable Object and its
container behind the kernel's `WORKBENCH` binding, kept out for the same reason;
a container's calls to the platform come back to the kernel's `SandboxOutbound`,
which holds the secret its placeholder is swapped with). `yak-esbuild` is a
Worker in front of a container running native esbuild; its image is
`esbuild/Dockerfile` over `packages/esbuild`, and its deploy builds and pushes
the image when its inputs change. Sibling preparation runs concurrently with the
kernel bundle. Dependencies must finish successfully before the kernel upload
begins; a failure waits for the other work and refuses the kernel upload.
`yak-front`, which calls the kernel, deploys last. The pinned Wrangler bundles
once, including node compatibility code and source maps; the upload reads those
generated modules without bundling again.

Hosted model execution has its own [executor release](../model/README.md),
independently deployed by Workers Builds. A production kernel build adds its
`MODEL` service binding only after that release has one fully serving version.
Until then, or if deployment inspection fails, hosted calls run inline. Staging
and local probes run inline. `MODEL_RECEIPTS` reads the executor's private
request and receipt bucket. Kernel builds never deploy or replace an executor
release.

An app's store is lent the model providers config.ts `serving` names
(providers.ts), each a plugin's `./provider` facet asked by the name it serves
under, the first for a model no row names a provider for; no layer imports one.
A provider named bare (`'@yaks/openrouter'`) is the app's own, called on the
app's connection through its egress; one given options of the Worker's is the
platform's, which pays. A call the executor runs carries each of the platform's
credentials (`{"secret": NAME}`) as a sentinel, which the kernel's `grants`
exchange only on the way to the hosts the provider says it calls. The executor
runs only the providers its own config composes; any other runs in the store.
`./api/ai/run`, documents and embeddings reach the own door of the first
`serving` provider that has one (@yaks/model `Native`, Workers AI's binding),
each call held to the space's budget (meter.ts `metered`).

The kernel deploys once; `yak-sandbox` names a stable sandbox toolchain image by
registry reference. The live Worker's assets carry the CLI workspace, compressed
and addressed by its source hash. A sandbox's `yak` fetches the live launcher
and workspace descriptor; a changed workspace is verified and installed
atomically before running the existing CLI. Each command uses its own immutable
source directory. Commands share Deno's module cache across CLI releases. The
CLI retains its lockfile and uses npm lazy caching, so a cold command downloads
only the dependencies it imports. The first `yak` call pays for the workspace
download and cold dependencies; later calls fetch only the launcher and
descriptor until the sources change. Measured first-call and deploy timings are
retained in
[bench/deploys.md](../../bench/deploys.md#sandbox-cli-delivery-t-65018).

The toolchain image is provisioned separately when its Dockerfile changes:

```sh
deno run -A workers/yak/sandbox/base.ts
```

Pin the resulting `base-<hash>` registry reference in both container configs
before landing. Worker deploys resolve that reference without Docker. The CLI
uses the connector's live `tools/list` schemas, so ordinary platform tool
changes need no CLI image rollout. Production finishes before staging begins;
both versions carry the same commit.

Never `wrangler deploy` by hand. Both tasks go through `wrangler.ts`, which runs
`pnpm install` when `node_modules` is behind `pnpm-lock.yaml` — wrangler bundles
the Worker's npm dependencies as files out of that directory, and it is
gitignored, so a fresh worktree has none and a bare `wrangler deploy` dies at
the first of them.

Correct a deployed regression with `yak admin revert <sha>`: main is always
deployed. `yak admin rollback [version]` is for a broken build path and refuses
to cross a data migration boundary. A Durable Object already migrated keeps its
data, even when older code is deployed.

A busy Durable Object takes new code up to 300 seconds after its version goes
live: Cloudflare defers an active object's code update until it hibernates or
`max_delay` (300 s by default) passes. A Builder working an Operator run stays
on the old version for those minutes while stateless requests serve the new one.
To see a fix live in an object, compare the `version` tag on what it reports
with `admin_deploys`, and look again once the 300 seconds have passed.

## Workers Builds

A push to `main` deploys, through Cloudflare Workers Builds — not through a
GitHub Actions workflow. Builds clones the repo itself and mints its own API
token, so no Cloudflare credential that can deploy exists in this repo, on the
Actions runner, or in a GitHub secret. The gate reads no Cloudflare credential
at all.

Nothing gates that push. `.github/workflows/gate.yml` runs `deno task check` and
`deno task test` in process, and it reports what it finds: a red test is a bug
to fix, not a deploy held back. T-37197 briefly promoted a gated `deploy` branch
instead; it was reverted the same day (M-37262).

The dashboard settings, in full (Workers & Pages → `yak` → Settings → Builds):

| setting                 | value                                                                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository              | `yak-sh/yak` (Cloudflare GitHub App)                                                                                                                                                                                                                                          |
| Production branch       | `main`                                                                                                                                                                                                                                                                        |
| Root directory          | `workers/yak`                                                                                                                                                                                                                                                                 |
| Build variable          | `SKIP_DEPENDENCY_INSTALL=1`                                                                                                                                                                                                                                                   |
| Build command           | `../../bin/build-yak install`                                                                                                                                                                                                                                                 |
| Deploy command          | `../../bin/build-yak deploy`                                                                                                                                                                                                                                                  |
| Build watch paths       | include `workers/yak/**`, `packages/**`, `src/**`, `deno.json`, `deno.lock`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `bin/build-yak`, `bin/build-tools`; exclude `**/*_test.*`, `**/README.md`, `.github/**`, `bench/**` (`wrangler.ts` `WATCHED`) |
| Non-production branches | build only; previews off for now (below)                                                                                                                                                                                                                                      |

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
nothing for the deploy catch-up to time (`bench/deploys.md`).

The kernel captures the toolkit catalog and sends it with each compiler job.
Jobs carry `x-yak-compiler-job: 1` and a JSON body of `{ask, catalog}`; the
compiler Worker streams that body to its container and preserves its response.
Catalog transpilation is reused from the restored Deno cache between builds.
Package changes update the kernel without changing the compiler Worker's bundle.

The build command installs Deno, pnpm and the workspace's node_modules only
(`bin/build-tools`); a Workers Build runs neither `deno task check` nor the
tests. `SKIP_DEPENDENCY_INSTALL=1` disables Builds' automatic install
([build image variables](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)).
Deno lives under npm's restored cache directory and pnpm's packages in its
default store, both of which Builds saves after the build command and before the
deploy command
([build caching](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/)).
pnpm is the version package.json's `packageManager` pins. `bin/build-yak deploy`
repeats the dependency check, which installs nothing when
`node_modules/.pnpm/lock.yaml` already matches `pnpm-lock.yaml`. Deploy mode
generates web assets and the compiler catalog together with the install. Sibling
bundles and the deploy pre-flight check (`superseded`) start once node_modules
is ready; the kernel bundle also waits for its catalog. Uploads wait for all
generated files and the guard. Each changed sibling's upload runs as its own
preparation allows. The kernel activates after all succeed. Each sibling is
bundled locally and compared with its fully serving deployment's
`inputs:<sha256>` annotation. The full digest is encoded as base64url, fitting
Cloudflare's 50-character deployment summary; the version annotation also
retains the full commit on its next line. A truncated hex annotation from an
earlier release is read from its sole serving version, then that same version's
deployment summary is refreshed once with the compact digest. The digest covers
every upload module, the inputs of each container image the sibling runs (its
Dockerfile and every file of its build context, `wrangler.ts` `images`), its
configuration, Wrangler pin and environment. A matching sibling stays serving
without another upload; changed inputs, an unreadable deployment or a release
without the annotation upload normally. The compiler image has its own
`inputs:<sha256>` registry tag, covering its Dockerfile and build context. A
changed compiler Worker reuses that image; only a missing image tag builds and
pushes it. A changed sibling uploads its prepared modules and source maps
through a temporary config beside the original, preserving its bindings and
naming the registry image. Wrangler bundles no second time and rolls the image
out without rebuilding it. Registry, build or push failures refuse the sibling
and kernel deploy. Workers Builds has Docker for changed compiler images. The
kernel is compared the same way (`wrangler.ts` `kernelStep`): its bundled
modules (not source maps or the metafile), its `public/` assets, its
configuration, flags, Wrangler pin and the executor it binds. Its version's
annotation keeps the commit and `began:` lines first and ends with
`inputs:<hex sha256>`. A push that changes nothing the kernel runs (a test, a
probe, a package it doesn't bundle) builds the same bytes, so instead of a new
version, which would start every isolate cold, the door deploys the serving
version under the new commit's message, and the guard, the deploy catch-up and
`yak admin deploys` see that commit live. The catch-up times no such deploy: its
version says when the commit that made it began. `bin/build-yak` with no
argument still runs the check and the workers tests by hand. Within a build, a
Wrangler deploy whose Cloudflare call fails for a moment (a 5xx, the containers
API's internal error, a version not yet readable after its upload, a spent or
refused asset upload session) runs again, three attempts in all (`wrangler.ts`
`runStep`). A push's build that fails is started once more through the
`BUILD_HOOK` deploy hook (builds.ts), since most failures are the network's.
While that build runs, the first failure is a log line, as it is when the hook
answers that a build of main is already pending (`hook.ts`, which the catch-up
reads its answers with too); the second build's failure is filed, and so is a
failure the hook refused or could not be reached for. A push Builds starts no
build for fails nowhere, so the box looks: its deploy catch-up
([@yaks/admin](../../packages/admin/README.md#the-deploy-catch-up)) starts
main's build through a deploy hook of its own once main's head is not live 3
minutes after it landed with no build under way, and reports it. A head whose
build failed is this rebuild's for 15 minutes; the catch-up builds it only if it
is still not live then.

Builds run on watched-path pushes and finish in any order. The deploy guard
(`wrangler.ts` `guard`) lets a completed build deploy unless a newer commit is
already live, so a commit goes live only when it equals or descends from what
serves. It reads live versions beside preparation, then again right before the
step that puts a version live and before each retry, since another build can go
live while this one prepares, uploads or waits. `wrangler deploy` uploads and
goes live in one call, so the kernel deploys in three steps (`staged`):
`versions upload` makes a version that serves nothing, `versions deploy` puts it
live once the guard has looked, and `triggers deploy` applies its crons and
queue consumers. A pending Durable Object migration, which only
`wrangler
deploy` applies, deploys in one step. A push to main does not stop a
completed build from deploying. A build behind a newer live version deploys
nothing, leaves the newer one serving and says why in its log; nothing is put
back after a deploy. The public gateway (`yak-front`) is promoted after the
kernel, including a re-promotion when its bytes are unchanged, so its service
bindings pick up that kernel. Its preparation overlaps the dependencies and
kernel build. `admin_deploys` observes `/_yak/version` through the public
gateway and names both responding Worker versions, beside the kernel promotion
history. The stateless version response loads no router or Durable Object and is
never cached; a promotion by itself is not evidence of what the gateway serves.

The sandbox tools use the Cloudflare provider in
[@yaks/machine](../../packages/machine/README.md#cloudflare-containers).
`sandbox.ts` checks allowances, supplies the caller's scoped grant, and counts
container seconds; the provider owns container RPCs and lifecycle. Grants and
the meter remain platform concerns.

The sandbox uses `sandbox/base/Dockerfile` as its complete image, pushed to the
registry once per version of that file as `yak-sandbox:base-<its hash>`.
`sandbox/base.ts` provisions a changed toolchain explicitly, before its registry
pin is landed. The CLI sources travel with the live Worker instead of the image,
so a CLI change adds no Docker work to a deploy.

## Store traces

Store requests are recorded in memory. Only requests reading or writing more
than 10,000 SQL rows, requested captures, and ordinary samples are delivered to
`yak-errors`; an unselected request performs no additional SQL or delivery. An
automatic over-the-line capture is admitted at most once per operation and name
per rolling hour in each Store incarnation. Suppressed repeats are counted in
memory and carried as `repeats{n}` on the next delivered root span. Requested
and sampled captures retain their independent N and rate bounds. The quota
resets on eviction and is never stored in app rows. Defects have independent
intake and do not consume the trace allowance. The independent
[tracker](../tracker/README.md) stores the trace and its separately addressed
spans and metric components.

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

The account holds `yak-errors` and the independent tracker Worker; the producer
binding in `wrangler.toml` sends defects and traces to that queue. Without the
binding, trace samples are discarded rather than writing into the app Store.
Each delivered trace chunk carries `during.space` on every entity, and immutable
ids make queue redelivery safe. The request's span counts close before delivery
and do not include delivery.

Defects go to the platform graph of
[the independent tracker](../tracker/README.md). This includes an exception
nothing caught, a break the router or a job catches, a Store's own, a connector
tool's, and a Workers Build that failed (builds.ts, fed by the `yak-builds`
queue's event subscription). Every catch reports where it happened through
`defects.ts`. The runtime wraps the gateway, service entrypoints and Durable
Object lifecycle methods to report escaping failures. The
[`@yaks/tracker` reporter](../../packages/tracker/README.md) sends the first
sample immediately, then one repeat sample with its hit count per ten-second
window. `waitUntil` retains the window after the response. A new bug sends mail
through the tracker independently of the kernel.

Each defect carries its tags (`tool`, `space`, `app`, `client`, `store`,
`request`) and the person's eid as `user_id`, with `account` set to `person` or
`test` (@yaks/platform/bots). Space and app slugs are tags; platform defects
stay in the platform tracker. The commit is the Workers version id and
`ENVIRONMENT` records `production` or `staging`. A refusal of the caller's input
is never sent. Tests and `wrangler dev` without an `ERRORS` binding send
nothing. Wrangler preserves function names in the minified bundle. To prove a
deploy's failures arrive, a test account POSTs `/api/defect` at the apex: that
is a defect tagged `tool:canary`, `account:test` (mcp.ts `canary`).

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
yak admin errors --as admin@bot.yak.sh
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
conservatively includes failed builds. A secret change's version has no message
and carries the commit of the upload it copied, the one just before it
(`sourceOf`, which deploy catch-up reads too when such a version serves); once
that upload ages out of the list, the copy's commit is inferred, which refuses
rolling back to it but to no other version. An inferred commit or incomplete
migration history cannot authorize rollback. `errors` reads every unresolved
platform bug (not resolved or archived), however old, newest first, through the
tracker's signed door. There is no time window by default; `--since` optionally
narrows by last seen. The header counts the matching bugs and each line gives
lifetime counts. The tracker connection in this box's config supplies the URL
and signing key. `tail` watches live traffic, using the box's GNU `timeout` to
stop Wrangler and its launcher together.

`revert` requires main to match its remote, creates a fresh worktree, and uses
the same primitive as `task land` to publish. It returns after the push; main's
CI and Workers Builds run asynchronously and report failures. No pre-land gate
or deployment wait holds the caller. A failed worktree is kept for inspection.
Neither a rollback nor a revert undoes migrated data.

The box's deploy catch-up times every deploy from push to live and reports
deploys that got slower as their own bug; main's gate times none of it. How, and
what a deploy's time is made of, is [deploy timing](../../bench/deploys.md).

## Everything set by hand

A deploy creates nothing on the account and holds no secret. Every piece of
configuration a person does by hand, production and staging alike, is one of
these three tables; each row says where it is set and what is missing without
it. Values never appear here or in the repo.

Mail uses the portable `@yaks/mail` sender selected by `MAIL_VIA`, from those
the mail providers `config.ts` names (`posts`) lend: `@yaks/cloudflare-mail` and
`@yaks/resend`, each a plugin whose options name the Worker's secrets and
bindings, and no other module of the Worker names a provider. The same plugins
lend the reader of a provider's signed notices at `POST /mail/<via>` and the
arrival `inbox.ts` reads Email Routing's letters with (`ARRIVAL`). When unset,
platform letters use Cloudflare's REST sender and apps and Operators use the
`MAIL` binding. `MAIL_VIA=resend` selects Resend for each, with a
service-specific `sending_access` app-domain key in the Worker secret
`RESEND_TOKEN` and a separate bot-domain key in `RESEND_PLATFORM_TOKEN`.
`RESEND_WEBHOOK_SECRET` authenticates signed receipts at `POST /mail/resend`;
they fill Message-IDs in app and Operator mail without granting Resend account
access to a Worker. `RESEND_API` and `MAIL_FETCH` replace only the HTTP boundary
in probes. Staging's `MAIL_SINK` redirects every recipient and removes copies
for either provider. Missing Resend credentials never fall back to Cloudflare.

Production selects Resend (`MAIL_VIA = "resend"` in wrangler.toml); staging
leaves it unset. Both `bot.yak.sh` and `yaks.app` are verified sending domains
in Resend. A deployment on another apex verifies that apex with Resend before
selecting it. Reply-tracking mailboxes also need the
[Message-ID receipt bridge](../../packages/mail/README.md#named-transports).
Receiving remains on Email Routing until Resend's MX, signed webhook, body and
attachment retrieval, and durable acknowledgement path are configured and
proved. Existing queued letters and receiving cursors are retained.

**Secrets** — `npx wrangler secret put <NAME>` from `workers/yak` (add
`--env staging` for staging); locally a `.dev.vars` line.

| name                                                                         | required   | value                                                                                                                                                                                                                                                         | without it                                                                                               |
| ---------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                                                             | yes        | any long random string                                                                                                                                                                                                                                        | no session verifies, no sign-in code is issued                                                           |
| `TRACKER_SECRET`                                                             | yes        | the independent tracker's signing key, shared with its scoped service door                                                                                                                                                                                    | app failure reads and archive/resolve cannot reach the tracker                                           |
| `MAIL_TOKEN`                                                                 | Cloudflare | Cloudflare Email Sending API token, for the Worker's own account (`CF_ACCOUNT`)                                                                                                                                                                               | sign-in code letters do not send                                                                         |
| `RESEND_TOKEN`                                                               | Resend     | separate sending-only API key for this Worker                                                                                                                                                                                                                 | selected Resend sender waits; sign-in mail is unavailable                                                |
| `CF_ANALYTICS_TOKEN`                                                         | yes        | API token, **Account · Account Analytics · Read** (see Analytics)                                                                                                                                                                                             | the meter and Visits report counts are off                                                               |
| `CF_WORKERS_TOKEN`                                                           | yes        | API token, **Workers Scripts, D1, R2, Vectorize · Edit; Connectivity Directory · Bind** (see App bindings)                                                                                                                                                    | an app's files deploy, its `worker.js` does not; no space gets a tunnel                                  |
| `BUILD_HOOK`                                                                 | prod       | deploy hook URL for `main` (Workers & Pages → `yak` → Settings → Builds)                                                                                                                                                                                      | a failed push build is filed, never built again                                                          |
| `BUILD_LOG_TOKEN`                                                            | prod       | user-owned Cloudflare API token (My Profile → API Tokens) with **Workers CI · Read** on this account; the Builds API refuses an account-owned one                                                                                                             | the failed-build report links to its log but has no step or error summary                                |
| `CF_TUNNEL_TOKEN`                                                            | tunnels    | API token, **Cloudflare Tunnel · Edit; Connectivity Directory · Admin**                                                                                                                                                                                       | connect answers 503, and so do rotate and disconnect on a pair the platform made; adopt works            |
| `CF_HOSTNAMES_TOKEN`                                                         | domains    | API token, **Zone · SSL and Certificates · Edit** on the zone in `CF_ZONE`                                                                                                                                                                                    | `domain_attach` refuses, saying so                                                                       |
| `REALTIME_APP`, `REALTIME_TOKEN`, `TURN_KEY`, `TURN_TOKEN`                   | voice      | the platform's one Cloudflare Realtime SFU app id and secret, and its one TURN key id and token (1Password, "yaks.app Realtime …")                                                                                                                            | every app's `./api/rtc/` answers 503 `voice_off`                                                         |
| `STRIPE_KEY`                                                                 | billing    | restricted Stripe API key (checkout, portal, Subscriptions read and write, Connect accounts and their checkouts); config.ts `payments` hands it to @yaks/stripe as its `key`                                                                                  | billing doors say the paid tier is not switched on                                                       |
| `STRIPE_WEBHOOK_SECRET`                                                      | billing    | `whsec_…` of the **Your account** destination (see the billing section); billing.ts verifies `POST /stripe/webhook` with it                                                                                                                                   | events go unread and are filed where the owner sees them                                                 |
| `STRIPE_CONNECT_WEBHOOK_SECRET`                                              | selling    | `whsec_…` of the **Connected accounts** destination (see the Connect section); sell.ts verifies `POST /stripe/connect` with it                                                                                                                                | `POST /stripe/connect` answers 503; selling otherwise works                                              |
| `PHONE_SENDER`                                                               | texts      | a `[vars]` line in wrangler.toml, not a secret: the phone and `number` every platform text goes from, and the only number a text signs up at, e.g. `{ via = "telnyx", number = "+18663141594" }`; a space's `sender{via}` beside `phone{number}` overrides it | nothing texts or calls                                                                                   |
| `PINNACLE_API_KEY`, `PINNACLE_SIGNING_SECRET`, `PINNACLE_NUMBER`             | texts      | Pinnacle send key, webhook secret and default sending number; receive at `/pinnacle/webhook`                                                                                                                                                                  | Pinnacle is unconfigured                                                                                 |
| `VOIPMS_USERNAME`, `VOIPMS_API_PASSWORD`, `VOIPMS_NUMBER`                    | texts      | voip.ms platform account and default number; personal connections keep their own credentials                                                                                                                                                                  | voip.ms platform sender is unconfigured                                                                  |
| `TELNYX_API_KEY`                                                             | texts      | Telnyx API key (Mission Control, Auth > API Keys); the webhook's public key is `TELNYX_PUBLIC_KEY` in `[vars]`                                                                                                                                                | the Operator sends no texts; the opt-in still saves                                                      |
| `TEXT_SIGNUP`                                                                | texts      | `on` signs up a stranger who texts `PHONE_SENDER`'s number, puts that number's QR code on invite pages, and lets the sign-in card take a US mobile number and text it the code; set once its toll-free verification covers it (T-138775)                      | a stranger's text is left unread, invites offer the letter alone, and the sign-in card asks for an email |
| `DEEPGRAM_API_KEY`                                                           | speech     | Deepgram API key (1Password "deepgram full api"); `SPEECH_FLOOR` in `[vars]` is the account credit below which speech pauses while it is a pilot                                                                                                              | `./api/speech` answers 503 and calls to the Operator are not answered                                    |
| `OPENAI_VOICE_KEY`                                                           | speech     | OpenAI key of the "yaks.app voice" project, which may use only its voice models and spend $10 a month (1Password "OpenAI yaks.app voice")                                                                                                                     | an Operator set to an OpenAI voice is not answered on a call, and its voices are not offered             |
| `VAULT_KEY`                                                                  | yes        | 32 random bytes in base64 (`openssl rand -base64 32`); never changed                                                                                                                                                                                          | the connections page says keys cannot be saved here                                                      |
| `PUSH_VAPID_KEY`                                                             | push       | the JWK of a P-256 private key, minted once per deployment (`vapidKey()` in @yaks/push); changing it ends every browser's subscription                                                                                                                        | the Operator page offers no browser notifications                                                        |
| `MAIL_SINK`                                                                  | staging    | the owner's address                                                                                                                                                                                                                                           | staging letters go to their intended recipients                                                          |
| `META_CONVERSIONS_TOKEN`                                                     | optional   | a Conversions API token for the dataset `META_DATASET` names (Events Manager > the dataset > Settings > Conversions API > Generate access token)                                                                                                              | Meta is told of no page seen or sign-up (meta-ads.ts)                                                    |
| `OPENAI_APPS_CHALLENGE`                                                      | optional   | the token OpenAI's apps directory issues                                                                                                                                                                                                                      | `/.well-known/openai-apps-challenge` 404s                                                                |
| `CIMD`                                                                       | optional   | `on` (default when unset) or `off`                                                                                                                                                                                                                            | nothing; `off` stops claiming Client ID Metadata Documents                                               |
| `ANTHROPIC_API_KEY`                                                          | optional   | the platform's Anthropic API key, for product use only (providers.ts)                                                                                                                                                                                         | the Operator runs on `@cf/zai-org/glm-5.3`; a `claude-*` model is refused as a missing key               |
| `OPERATOR_DELEGATE`                                                          | optional   | the model the Operator hands coding and tricky work to (default `claude-opus-5-5`)                                                                                                                                                                            | nothing                                                                                                  |
| `OPENAI_API_KEY`                                                             | models     | OpenAI key of the "yaks.app images" project, which may use only the GPT Image 2.5 and 2.6 models and spend $20 a month (1Password "OpenAI yaks.app images")                                                                                                   | an app's GPT Image asks are refused                                                                      |
| `OPENAI_OPERATOR_API_KEY`                                                    | optional   | A separately scoped OpenAI key for Operator text models and their native file inputs; image generation keeps using `OPENAI_API_KEY`                                                                                                                           | Operator OpenAI calls use the existing `OPENAI_API_KEY` credential and its allowed models                |
| `OPENAI_MODELS_KEY`                                                          | models     | OpenAI key of the "yaks.app models" project, which may use only GPT-6 Luna and GPT-6.1 Terra, the models that answer the chat names `./api/ai/run` aliases (config.ts `aliases`); $300 a month limit, not yet enforced (1Password "OpenAI yaks.app models")   | those names are answered by Workers AI again                                                             |
| `AI_GATEWAY`, `AI_GATEWAY_TOKEN`, `BUILDER_MODEL_FREE`, `BUILDER_MODEL_PAID` | optional   | the other builder provider; all unset on purpose (T-34238)                                                                                                                                                                                                    | nothing; both tiers build on Workers AI                                                                  |
| `MAIL_DEV`                                                                   | local      | `1`                                                                                                                                                                                                                                                           | never set on a deploy: letters become entities instead of sending                                        |

**Vars and account resources** — `wrangler.toml` names them; the account must
already hold them (staging: the `[env.staging]` copies, `yak-*-staging` names).

| what                                                                       | where                                                                                                                                                   | without it                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `CF_ACCOUNT`, `APEX`, `WORKER_NAME`, `DISPATCH_NAMESPACE`, `VIEWS_DATASET` | `[vars]`; must name the same resources as the bindings                                                                                                  | REST calls (app uploads, analytics reads) aim at the wrong place |
| `CF_ZONE`                                                                  | `[vars]`, the zone id of `yaks.app` (staging: `yaks.fyi`, empty until set)                                                                              | custom domains refuse provisioning                               |
| `STRIPE_PRICE`                                                             | `[vars]`, the recurring Plus price id, which config.ts `payments` hands @yaks/stripe as `prices.plus.month` (staging: the sandbox price the probes buy) | checkout has nothing to sell                                     |
| `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_YEAR`                                | `[vars]`, the Pro plan's $49 monthly and $490 yearly price ids, which config.ts `payments` hands @yaks/stripe as `prices.pro.month` and `.year`         | the Pro plan is not offered, and checkout refuses it             |
| R2 bucket `yak-blobs`                                                      | `wrangler r2 bucket create <name>` once                                                                                                                 | no app files                                                     |
| Lifecycle rule on `yak-blobs`: objects under `.uploads/` expire in 7 days  | `wrangler r2 bucket lifecycle add <name> uploads .uploads/ --expire-days 7` once                                                                        | the ledgers of uploads nobody finished stay (blob-key.ts)        |
| Dispatch namespace `yak-apps`                                              | Cloudflare for Platforms, created once (`wrangler dispatch-namespace create yak-apps`)                                                                  | apps with a `worker.js` serve their files instead                |
| KV `OAUTH_KV`                                                              | `wrangler kv namespace create` once; paste the id into the binding                                                                                      | the OAuth door has no store                                      |
| D1 `yak-vault` (staging `yak-vault-staging`)                               | created once; its id is in the `VAULT` binding                                                                                                          | no connection's key can be saved                                 |
| Email Sending + Email Routing on the zone                                  | Cloudflare dashboard: onboard the zone, add its issued mail DNS, catch-all → this Worker                                                                | no outbound mail from apps, no inbound mail                      |
| DNS `AAAA @ → 100::`, `AAAA * → 100::`, proxied                            | Cloudflare DNS on the zone                                                                                                                              | the routes have nothing to attach to                             |
| Custom domains fallback origin + `*/*` route                               | Cloudflare for SaaS on the zone                                                                                                                         | a customer's own hostname never reaches the Worker               |
| Workers Builds                                                             | dashboard settings table above                                                                                                                          | nothing deploys on push                                          |
| Containers                                                                 | Workers Paid with Containers enabled; the deploy builds the image                                                                                       | the builder's sandbox tools say so and do not run                |

**Stripe dashboard**, sandbox first, then live:

| step                           | where                                                                                     | without it                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Managed Payments               | Stripe is the merchant of record for the paid tier (billing.ts); enable it on the account | tax and invoicing fall to us                                   |
| Product + recurring price      | Product catalog; the price id is `STRIPE_PRICE`                                           | checkout has nothing to sell                                   |
| Pro plan product               | Product catalog: $49 monthly and $490 yearly prices, `STRIPE_PRICE_PRO{,_YEAR}`           | the Pro plan is not offered                                    |
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
new shape ships after the version that created it. A new unique index is built
over existing rows whenever they fit it. Where rows share its key, the wake
leaves it unbuilt, reports it, and the store serves without the constraint until
a pass prepares those rows; a draft's deploy that declares it is refused with
the same reason.

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

A rule can declare retired source properties for its migration reads. Those
properties remain private to the mover and contract after the final batch; the
serving vocabulary keeps one shape. A retired component a store holds no table
for is unspoken there, so the rule is done with nothing to move. The directory
and the git store, which speak only the platform's words, keep a retired
component's table while it holds rows, for a rule to move or delete them, and
drop it at the first install that finds it empty. A core rule skips components
owned by an app's own declaration.

A rule can also forward records to the durable tracker queue. The mover prepares
a bounded source snapshot, waits for every queue acknowledgement, then commits
guarded source patches and its cursor together. A failed send keeps the source
rows; retrying uses the same occurrence ids. Rehearsal rolls back source patches
and sends no queue records.

An app's declared lens also supplies its mover rule. Its expanded vocabulary
holds source columns only while they hold values. The final batch drops empty
translated app properties and columns in the same transaction as its stamp;
rehearsal rolls those schema changes back too. The store retains its newest
vocabulary and immutable lens history when app code rolls back. A kept page's
deploy selects its `$speaks` for writes, dry runs, streamed imports, reads,
subscriptions and vocabulary declarations, including composed app/home access.
Core platform columns remain owned by the platform's vocabulary.

## Draft previews

`app_preview` gives an app's private link (`app.followed`, preview.ts), minted
once and kept across deploys: it serves the app's draft, or the release where
there is none. Each request serves the draft's newest `written` rows over the
release as a release of their own, built the first time the link serves that
state: what changed is compiled, and the worker, the link's own Store's
vocabulary and seed rows are set up again only when a write changed them. Each
write, and each deploy, is told to the link's pages over that Store's socket
(`{"draft":…}`), and public/release.js swaps a stylesheet in place or reloads.
The Store's expiry alarm, thirty days after the draft's last change, removes its
test data and script. Browser screenshots are `yak-browser`'s, the sibling
behind the `BROWSER` service binding, which holds Cloudflare's browser in
production and staging; no Browser Run REST token or local browser is needed.
Browser time spends the account's existing budget at $0.09/hour, including
failed captures. See
[Cloudflare Browser Run](https://developers.cloudflare.com/browser-run/).

The connector's image content accompanies structured console messages,
JavaScript errors, HTTP status, viewport, expiry and estimated browser cost. The
vendored axe-core checker reports WCAG 2.1 A and AA problems per element and
elements requiring manual review; findings never refuse a release. The build
workflow and limits are in [Files and Uploads](public/docs/files.md).

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

## Form submissions

`POST ./api/form/<form>` takes JSON `{answers: {<question eid>: <value>}}`. The
form can be addressed by eid or `alias{name}`. The door writes a completed
registration as the app, matches the directory, and answers an empty 204. It
refuses missing required answers and closed or full forms without writing
anything. Submitting grants no read access; the app’s existing access policy
still applies.

`GET ./api/form/<form>` shows the form, so a page in any app can draw one kept
in another, private one. It answers anyone, as POST does, from the app's own
store: a stranger served a published app's sample (visit.ts) still meets the
app's forms. It answers `cache-control: no-store`, with the form's own rows and
nothing else in the store:

```json
{
  "entity": { "eid": "<form>" },
  "doc": { "title": "Tea", "body": "Bring a cup." },
  "form": {
    "opens": "…", "closes": "…", "capacity": 20, "thanks": "…", "closed": "…"
  },
  "open": true,
  "questions": [{ "entity": { "eid": "<question>" }, "question": { … } }]
}
```

A caller signed in as one of the app's own people (recognized.ts: a row wearing
the number they signed in with, or an `individual` whose `email` lists their
address) is also answered `answers`, the values their row holds for each
question whose `fills` names it, and their submission is written with
`registration.person` naming that row and `registration.submitter` naming them.
Nobody else is answered any.

A completed sign-up whose form says `shares{question, is}`, and whose answer to
that question is `is`, also writes `shared{form, registration, answers, at}`
with its answers to the questions marked `question.shared` (form-rules.ts). The
app's viewers read it; the registration stays with its editors.

`doc` and `form` carry only the properties shown, those the form has, never
`form.notify`. `open` is @yaks/forms `open` now, over the count of accepted
registrations. The answer is a @yaks/forms `Form` (`form` and `questions`), so
`next` and `missing` take it as it comes. A missing form answers 404.

`<app>/form/<alias>` resolves the alias to a form and serves the app’s ordinary
page at that path. The app supplies its page and form rendering. A completed
registration owes `form_post`: durable email to `form.notify` recipients and a
confirmation to the submitted email, or the matched person’s directory email.
These letters use the app’s existing mail sender and allowance.

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

## What a million views cost

A visit is never refused to keep a bill down: a published app takes all the
traffic it gets, and what reaches the owner is a letter (below). Prices are
Cloudflare's published Workers Paid rates (Workers, Durable Objects, R2 and
Analytics Engine pricing pages, read 2026-11-02); CPU figures are this account's
own, from `workersInvocationsAdaptive`.

| What one request uses                    | Price                       | Per million requests |
| ---------------------------------------- | --------------------------- | -------------------- |
| a yak-front request                      | $0.30 per million           | $0.30                |
| a Site cache hit behind it               | $0.30 per million, or none  | $0 to $0.30          |
| yak-front CPU, about 1 ms on average     | $0.02 per million CPU ms    | $0.02                |
| a page's view point (`VIEWS`, html only) | $0.25 per million, unbilled | $0.25 (pages only)   |
| a use receipt (`USES`)                   | once per app, isolate, hour | about $0             |
| R2 class B read, on a cache miss only    | $0.36 per million           | about $0             |

So a page or file yak-front answers from Site's cache costs **$0.32 to $0.62 per
million**, and a page view adds $0.25 for its view point once Cloudflare
starts billing Analytics Engine (it says it does not yet). A million views of a
page that loads four files from the cache cost **$1.60 to $3.10**, plus $0.25.
Which Site row applies is not confirmed: the Workers pricing page says a
response from a Worker's cache is billed as a request, and also that a call
through a service binding adds no request fee; a hit through `SITE` is both.

A request yak-front hands to the kernel (anything `spaceDoor` claims, such as
`/<app>/api/assets/…`) costs about **$1 per million**: the front request, the
kernel's CPU (13 ms on average, 5.5 ms median, Oct 28 to Nov 2: $0.26), a
directory and a store Durable Object request ($0.30), and their duration (a
guess, about $0.10).

The plan includes, each month and for the whole account: 10 million Workers
requests, 30 million CPU ms, 1 million Durable Object requests, 400,000 GB-s, 25
billion rows read, 50 million rows written ($1 a million after, a thousand times
a row read), 10 million Analytics Engine points and 10 million R2 class B reads.
October used 2.7 million requests and 21 million CPU ms. The busiest day so far,
the Hacker News share of companygardener/openai-math on Oct 15 (before
yak-front), was 748,000 kernel requests, 5 million CPU ms, 1.43 million Durable
Object requests, 24,700 GB-s and 1.1 million rows written: about $2 at overage
rates even if none of it had been included.

**The alert.** Every hour the meter's sweep (usage.ts, usage-alert.ts) reads the
account's Durable Object requests, rows read and written and duration, and every
Worker's requests and CPU, and mails `hello@bot.yak.sh` (mail-config.ts
`INTERNAL`, filed on the yaks.app project's board) when one passes 80% and again
100% of what the plan includes, or when a settled hour's rate projects $25 a day
or more at overage prices. The rate reads a separate, complete hour ending at
least ten minutes before the sweep, names that interval in the letter, and
counts incoming WebSocket messages at 20:1. Monthly totals determine allowance
warnings, never the rate: revisions to older analytics are not current spending.
Cloudflare's own Billing Budget Alerts (dashboard, Notifications) mail too, when
the month's usage charges reach $0.01, $20 and $50; Cloudflare offers no
spending cap to set beside them.

**The ceiling.** So the cap is kept where statements run. Every object's driver
counts its statements against a minute and an hour of rows (@yaks/durable-object
`bounded`, `WINDOWS`: 50 million read or 100,000 written in a minute, 200
million or 500,000 in an hour), and every object but the directory stops when it
passes one (defects-runtime.ts `instrument`), until the window ends. At these
prices an object costs at most about $0.20 of reads and $0.50 of writes an hour
while stopped, plus the statement that passed it. What a stopped object answers:

- A Store's read (`/query`, `/call`, a socket's watch) is 429 with `retry-after`
  in seconds and `{error: 'Stopped', message, retry: {after}}`; the kernel
  relays both (apps.ts `waited`, kernel.ts), and a page's watch is declared
  again after the wait (client.js).
- A Store's write (`/apply`) is kept in its write log as `pending` and answered
  202 `Pending` with `retry-after` (graph.ts `#kept`), which the kernel's
  `/api/apply` passes on (meta.ts `written`); a write the window stopped as it
  applied, or as the alarm replayed it, waits the same way, its try uncounted
  (writes.ts `unstarted`). The alarm, armed for the window's end, replays them
  in order. A page's outbox sends again no sooner than `retry-after` (@yaks/sync
  `outbox`). Past its written rows only, a store still reads.
- Its alarm and `tick` do nothing but come back when the window ends; replays,
  wakes, effects, embedding, moves, the lexicon and planner statistics wait and
  are marked neither failed nor stuck. An effect stopped mid-run is due again
  after the wait as the same attempt, and one that ended while stopped is not
  run again: the pool writes down how it ended inside the ceiling's `free`
  (@yaks/effects `PoolOpts.free`), so an eviction can't lose the word.
- A Builder answers each door 429 the same way; its alarm comes back then. A
  chat line said to it meanwhile is kept in its own write log (build.ts
  `#hold`), told back as said with when it will be answered, and taken up as its
  own turn, oldest first, by the alarm at the window's end (`#replay`).
- The directory is told of a runaway and never stopped: every door reads it, so
  stopping it would stop the platform. A relocation counts its rows, is never
  stopped half way, and leaves neither end stopped (relocate.ts `freely`).

## A reviewer's sign-in link

An app directory's reviewer gets a link, never a mailbox: OpenAI rejects
credentials behind an email code, and Anthropic asks for a fully populated test
account (T-34351). A standing link signs its holder in until it expires and is
worth a session and nothing more — so it is minted by the account it signs in,
with `yak admin` (link.ts, identity.ts `/login/link`):

| act    | command                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| mint   | `yak auth yaks.app --as=chatgpt-reviewer@bot.yak.sh && yak admin link --days=90 --as=chatgpt-reviewer` |
| revoke | `yak admin link --revoke=<id> --as=chatgpt-reviewer`                                                   |

`yak auth yaks.app --as=<name>@bot.yak.sh` mints the account and signs it in,
leaving the box's current account as it was; `--as` names it on each command
after. `yak admin link` prints the URL, the id that revokes it, and when it dies
(30 days by asking for nothing, a year at most). Build the account out — an app
or two — before handing the link over, since a reviewer is asked to walk a
working account. Add its name to `PROTECTED` (idle-spaces.ts) first: the sweep
and `yak admin erase` keep what's named there however long it sits idle, and a
`space_delete` of it asks by letter.

## STRIPE_WEBHOOK_SECRET — the billing door's events

billing.ts is the platform's own plan: Stripe sells to us, and tells us at
`POST /stripe/webhook`. @yaks/stripe serves that door (its `webhook` door, lent
through config.ts `payments`, which names this secret beside the key and price
ids above, and served by payment-doors.ts): it verifies each event and reads six
v1 events and nothing else. A block of AI credit (billing.ts `buy`) is a
Checkout in payment mode: `checkout.session.completed` credits it when its money
is there, and `checkout.session.async_payment_succeeded` when it arrives later.
The dashboard steps are the Connect ones below with these differences:

| step | where                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3    | **Events from**: **Your account**                                                                                                                                                                                                |
| 4    | Select these six v1 events, and only these: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` |
| 6    | Endpoint URL: `https://yaks.app/stripe/webhook`                                                                                                                                                                                  |
| 8    | `npx wrangler secret put STRIPE_WEBHOOK_SECRET`                                                                                                                                                                                  |

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

@yaks/stripe serves that door too (its `connect` door, the secret named in
config.ts `payments`). Until the secret is set, `POST /stripe/connect` answers
503 in one sentence and everything else still works: a space connects, a
checkout session is created, a buyer pays. What is missing is only what the
events would have told us.

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
the deploy, so there is nothing to verify at that point; and the gate reads no
Cloudflare credential, so `wrangler tail`, the half that catches a 5xx, cannot
run there. A gate-side check would also race the Builds deploy and verify
whichever version happened to be live, which is a green that means nothing. So
it stays one command, run after a Builds deploy goes green. `--tail 0` skips the
tail and needs no credential at all. The box's deploy catch-up asks for the home
page alone once main's head goes live, and reports it not answering.

## Gallery demo copies

A private gallery app owned by the platform staff gets a copy in `yourname`,
installed from its published version, kept private and published. Each stranger
there reads the copy's sample, made from its seed, and their first write gives
them a store of their own (visit.ts). Republishing a listed source refreshes the
copy.

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

## Store composition

The Worker's application names its HTTP doors in `kernel.ts` and `apps.ts`, its
guide pages in `guide.ts`, and its connector rows in `tools.ts`. App pages call
`views.ts` to record visits. Store anatomy observes the assembly and the
Worker's host hooks, commands and effect registrations in `anatomy.ts`.

`config.ts` selects the directory, app and git stores' plugins, facets and
words. `gen.ts` writes `load.ts` from those configs and package exports, using
literal imports for bundled graph, effects and tool facets. The connector lists
the configured package tools with `space` and, for app stores, `app`;
`package-tools.ts` forwards their calls to the selected Store's `/call` ledger
and runner as the caller. Published names whose contracts differ remain
translations in `published.ts`; their package contracts use a `store_` prefix.
The shared directory selects the space-bound memory save/recall loop, with space
supplied by its host, and connections validate the selected owner and app. The
Worker's own store facets live under `facets/`.

`mcp_connect` configures a person's remote MCP server in the directory as
`mcp_server{owner,name,url,machine,enabled,allow,client_id}`. `mcp-remote.ts`
uses `@yaks/mcp-client` for discovery and calls, and `@yaks/connections` for
that person's sign-in and vaulted credential. Operators receive namespaced
tools; the connector discovers the same commands at `mcp:<server eid>` through
`commands` and invokes them through `command`. Code mode lists them under its
`mcp` object while the connector's published tool roster stays fixed. Discovery
failures report to the tracker and leave a retryable connection status command.
Calls recheck ownership and the current configuration, and never retry a remote
mutation after a missing response or a sign-in challenge.

A server with `machine` runs on the machine a space's tunnel goes to: `machine`
is that space, `url` the server's path on the machine, and `mcp_connect` takes
the space's slug. It is asked through the tunnel's gateway (`tunnel.ts`
`machine`) with no discovery, sign-in, integration or connection. Each list and
each call reads anew that the row's owner owns that space, from the whole
directory; to anyone else the server is not connected. Every request handed to a
tunnel's gateway says who is asking in `x-yak-caller`, which only the platform
sets: `operator` for the owner's Operator, `connector` for the owner's own
`command` call, and `app` for an app's worker (`tunnel.ts` `reach`). The
machine's config opens each path to all of them or to the callers it names
(@yaks/tunnel `callers`), so an app in the space can't reach a path its owner
opened to their Operator. A request made in an Operator conversation carries
that conversation's session id as `x-via`, a fork's or a helper's included, and
a call from `command` carries none. A machine that is off, a tunnel with no
gateway and a path the machine has not opened leave the connection status
command and report nothing to the tracker.

A server's schema loses each `ref` it says on an argument (`mcp-remote.ts`
`foreign`): a graph's own MCP door names a kind in its graph there, and this
host would resolve it in the person's graph and refuse an id only the server
knows.

A machine's server that lists `comment_new` gives its owner's Operator one more
tool, `<server>__message_relay` (`operator-relay.ts`): one of the person's own
messages in the conversation becomes their comment on an entity on the machine.
The model names the entity and the message (its id, the Sent time its header
shows, or none for their newest) and supplies no words: the host reads the line
from the Operator's store, takes it only if the person wrote it (`ownWords`: an
input stamped `created.by` them with no other writer named, never the
Operator's, a helper's, the platform's, an outside agent's or a caller's on the
phone), and calls the machine's `comment_new` with those words as the
conversation draws them, without the framing the model read. That one request
says whose act it is (`Calling.own`, sent as `x-yak-by` with the person's id),
which nothing a model or an app sends can, and the machine writes it by its own
person through no session (@yaks/tunnel `owner`). Where the server also lists
`decision_answer` and `graph_show`, `choice` answers a decision the same way,
and only with a label the decision lists, read from the machine first: an answer
in the person's own words is their message as a comment.

A server a person connected can offer their Operator's page lists, drawn beside
the conversation with no model turn (`operator-lists.ts`). `mcp_connect`'s
`lists` sets them in order, each a title, the server's tool and the arguments it
is called with, and whether its rows wait on the person; each is a row of its
own, `doc{title}` + `mcp_list{server, tool, args, waits, ord}`. Jeff's are What
needs you (`task_list` over the Asks board's query, waiting), Working now
(`task_list` over the tasks a session holds) and Spend (`spend_show` with
`plans`, his plan limits against their pace). The chat page reads them all at
once, beside the conversation, and draws each under its title: the first ten
rows in the server's order, a line for what each is, a line for what it asks,
its choices, and Reply, which fills the box, the rest under one line saying how
many; an answer of words alone is drawn as its lines. Only the rows of a list
that waits count on the bar and the installed page's icon. A choice is the
person's own answer, sent through the relay's door (`answerAsTheirs`). A list
from a machine shows only on the page of the space whose tunnel reaches it, and
a machine that is off, or that takes more than 3 s, is said to be.

Every request through a tunnel to a machine counts in the page's `machine_wait`
(timing.ts). On 2026-11-10, ten loads of the `checks` landing page, whose tunnel
goes to the box, read the box's Asks board (50 rows) in 277–642 ms of
`machine_wait`, about 400 ms typically, against 228 ms for the same read from
the box's own CLI. The read runs beside the Operator's own (`operator_wait`,
726–1304 ms on the same loads), so it adds nothing to the page.

`machine_wait` sums every request, so lists read at once add up in it. With
Jeff's three lists (What needs you, Working now, Spend) on the `checks` page,
the box answered all three in 51–110 ms at the box, as the tunnel's Operator
caller. Through the tunnel, ten loads took 1,055–2,244 ms of `machine_wait`
while each list opened its own connection and listed the server's tools before
calling one: 15 requests a page. A server's lists now share one connection, and
a call is sent without listing first (mcp-remote.ts `calls`): 6 requests. Ten
loads after that read 469–1,079 ms, about 700 ms typically, beside 1,021–1,782
ms of `operator_wait`.

The lists never hold the conversation back: the page waits on the directory for
which lists there are (operator-lists.ts `listingOf`), and those whose servers
have not answered when the conversation is in are drawn as a place the page
fills from `?lists`, which also brings the bar's count (operator-page.ts
`chatPage`).

That `operator_wait` was the Builder drawing the conversation, on CPU. On
2026-11-10 the `checks` page was 4.07 MB, 3.4 MB of it in 12 folds of outside
chats, each drawing the Operator's whole context again (114–121 tools), and each
read drew everything once more for its lines as data, which only the iOS shell
asks for. Five warm loads: `operator_wait` 1,114–2,117 ms, the Builder's CPU
989–1,285 ms a read. A fold now leaves out what its chat's model was told, which
the conversation draws above and the chat's own page draws in full
(operator-host.ts `threadsOf`), and a read draws its lines as data only when
asked. Ten loads after: the page 834 KB, `operator_wait` 249–592 ms (most
260–400), the Builder's CPU 179–478 ms. What remains is mostly the
conversation's own first context, about 240 KB, drawn once.

A Store imports its graph and effects facets before opening its boot
transaction, then binds them with `@yaks/host` over its storage, vault, blobs
and named mail sender. Cold reads owe no start-up work. A deployment calls the
registry's start-up door to install providers and integrations and seed the
directory's schedules. The configs retain each store kind's existing words; an
app's own vocabulary shadows the configured words in its store. New internal
control documents carry `reserved: false`: their effects compose without taking
names away from app components.

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
names a change's component by its row. Their release is the Worker's, so every
commit on main owes their deployment pass (descriptions, start-up effects,
planner statistics) once: the first request under a new version arms their alarm
for it and is served at an ordinary wake's cost. Planner statistics a pass owes,
in any store, are analyzed a table at a time from the alarm (@yaks/sqlite
`analyze`). Schema changes retain unchanged FTS indexes and writers.
Classification audits are explicit repairs, not release installation work. The
inspector omits history when its vocabulary has no `_change`. A store whose
words keep no journal drops the journal's tables, with their rows, in its next
schema pass (migrate.ts `unjournaled`); a table its words declare stays. Schema
rows are excluded from ordinary page listings unless named explicitly, like
other platform-owned rows.

## Space operator

`operator_chat({space, say})` starts a private task and a native harness fork of
the caller's main Operator conversation in the space's existing Builder object.
`say` can be a short request or a design. `operator_run` is an alias with the
same arguments and behavior. It uses the connector's tools to read and change
that space's apps, files and rows. A renewed space scope applies to each tool
call. Model requests charge the space's shared dollar budget as they answer;
there is no round limit.

The result includes `task`, `session`, `text`, `status`, `model` and `cost` in
USD. After 25 seconds of work, a call returns its progress while the task keeps
running. A settled call returns its answer; otherwise use `operator_read` for
the progress and eventual answer. `cost` counts model use recorded so far.
`operator_read({space, task})` returns the task, comments and conversation; a
conversation's session returns its newest 64 lines, and while lines come before
them, `earlier: {count, before}` says how many and the `before` to pass for the
64 preceding. `context: true` also includes model instruction snapshots. Omit
`task` to list recent tasks. Continue with `operator_chat({space, task, say})`.
A settled model turn may be a question: the operator explicitly completes a task
through `task_update` after finishing it.

The fork inherits the main conversation's completed context. Each caller input
and reply stays in the fork. Five minutes without another input closes a settled
chat, after its helpers finish, and writes one passive notice in the main
conversation: what was asked, the final report, and outstanding work. Stopping
or failing closes it immediately. The notice starts no model turn. The quiet
interval is recorded as `spawned.quiet` in milliseconds; the object's alarm
reconstructs its deadline from the newest input's timestamp after a reset.
Closing marks the chat `completed{}` so later alarms skip it. A new input clears
that mark; closing again updates its existing notice. Each turn uses the
caller's current permissions.

`helper_spawn({space, task, brief, model?})` queues a helper under the private
chat named by `task` (its task or session id), and returns
`{session, parent,
text}` immediately. The helper uses the caller's permissions
and the space's shared budget. `operator_read` and `operator_stop` accept its
session id. Helpers report by passive notice to the thread that started them;
their results are included in that chat's closing notice. A failure also reaches
the main thread immediately, and a question filed with `decision_new` sends a
passive notice there pointing to the choices in Updates. Routine helper
completions start no model turn in either thread.

`operator_retry({space, request})` runs a request that could not finish again,
as itself, once its cause is fixed: its failure and the answer that told of it
are dropped, and its intake runs anew.

The Operator runs on the first of config.ts `agents.operator` whose provider the
Worker holds every credential of: `claude-sonnet-5-5` on Anthropic when
`ANTHROPIC_API_KEY` is set, and otherwise `@cf/zai-org/glm-5.3` on Workers AI;
`OPERATOR_MODEL` names another model of the provider chosen. Each is served by a
plugin config.ts `operatorProviders` names, lent the platform's transport and
keys (providers.ts); no layer imports a provider. This config selects
`OPENAI_OPERATOR_API_KEY` for the Operator's OpenAI conversations when set,
otherwise the existing `OPENAI_API_KEY`. Image generation and app model calls
keep their existing credentials. An input asking another model gets it where the
Operator's provider lists it, and the Operator's own otherwise. The model must
have a price, from its provider's list or @yaks/model's. With a delegate
(Anthropic's), a conversation and its forks have `spawn`, whose description
sends writing or fixing code and tasks that need careful reasoning to
`OPERATOR_DELEGATE` (`claude-opus-5-5`) in a child session working for the same
space and charged to it; the child's answer comes back to the session that
asked, and the child is offered no `spawn` of its own. This entry accepts text.
Picture attachments and the email, chat and SMS interfaces are separate work.
Interrupted requests remain in the graph and can be continued explicitly; they
do not resume automatically.

A platform admin who owns a space with a tunnel is answered by their own machine
instead (operator.ts `machineFor`, the one place that says admins only): words
of theirs that name no model record `using{provider: machine, model}`, the first
model config.ts `agents.machine` names. The provider `machine`
(`provider{name, transport: 'machine'}`) is @yaks/model's forwarding provider
over the space's tunnel (tunnel.ts `machine`), so each step is a POST to
`/model/step` on the machine, which answers it from the providers its own config
serves, by the model's name. The space is charged nothing for such a step, and
no price is asked for its model. Anyone else's turn in the same space (a
member's, a stranger's text, a form) runs on the hosted model as before, and so
do words that name their own model, as a call's do. `operator_chat` takes
`provider: "machine"` with a `model` from the machine's owner alone.

A step the machine fails before its first output (the tunnel or the machine does
not answer, a provider's allowance is spent, a provider takes no such input) is
asked of the next model `agents.machine` names, which is the machine's other
provider, and then of the hosted model, which the space pays for
(operator-machine.ts `falling`). Every step asks the machine first, so nothing
needs resetting once it is back. The first step of a conversation that falls to
the hosted model writes a line there (`operator_hosted{code}`) telling the model
to say so once; the line stands until the machine answers that conversation
again, which marks it `completed`.

Only the owner's own words, and words that tell him something failed (a break to
fix, what another conversation raised), fall that far. A turn bringing routine
news nobody asked for at that moment (a knock from his machine, a wake-up, a
subscription: the channels operator-channels.ts `UNASKED` names, and scheduled
work's helper) has no hosted leg, so the space never pays for it. Its ask is
left owed (`provisional`) as a wait (`retry.defer`), which spends none of its
run's tries and files nothing, however many days the machine is away. The runner
leaves it alone (`answers`) until the machine looks able: once a `HEAD` of
`/model/step` through the tunnel answers under 500, looked at once a minute at
most, or, where the machine's providers refused it, an hour after it failed.
Knocks that arrive meanwhile are lines of the same conversation, so when the
machine serves it, one turn answers all of them. Words the owner gives meanwhile
owe a run of their own, which does not wait.

Measured on 2026-11-10 on the Operator page's socket, in the owner's own
conversation: a step on `sonnet`, served by the `claude` CLI on his machine,
typed its first text 4.1 s after the page was sent his words, and its reply had
landed 1.5 s after that. Its prompt was 73,437 input tokens, 66,464 of them
cached. The turn before it, the same prompt uncached and answered in one word,
took 6.1 s from the ask to its reply.

Where such a step's time goes, measured the same day from the Worker's
`yak operator ask` log lines (operator.ts `asked`) and on the machine. These are
six one-word `sonnet` turns of about 71,000 input tokens:

1. The Worker before it sends the step (`at_submit`): 0.8–1.3 s, spread over
   about six stages of store and directory reads, the largest 0.4 s.
2. The tunnel to the machine (`machine_wait`): 0.2–0.5 s.
3. The machine's `yak serve` before `claude` starts: 0.05–0.2 s.
4. The `claude` CLI's own start: 0.4–0.6 s.
5. The model's first token: 1.3–2.6 s. A three-word `sonnet` prompt takes
   1.35–1.45 s, and `haiku` 1.25 s, so neither the model nor a cached prompt's
   size accounts for much of it.

Each step had sent the transcript as one string, which missed the prompt cache
whole. Since @yaks/claude sends it one item per block, a step reads all but its
newest items from the cache: in that conversation, consecutive steps read 70,189
of 70,717 tokens, where they had read 68,544 of 70,922. Its transcript is short,
so first text barely moved: 2.7 and 3.5 s from the words, after 3.2 and 4.5 s
before, within the model's own variance. The saving grows with a conversation's
length.

The Worker's own share, measured again the same evening on warm one-word turns
in the same conversation, fell from 0.8–1.3 s to 0.36–0.53 s. Each step's
`yak operator ask` line now carries a `trace`: every directory, store, vault,
copy and machine wait, as `<began>+<ms> <wait> <what it asked>`, in ms from the
step's start. It showed two directory round trips in a row, each 0.19–0.33 s
from that conversation's object: the space, the person's reach and seats, the
spaces that let the Operator in and the admin check first; then the person's
Google connections, their MCP servers and the home space's page, which waited
for the step's context.

Those now go in the first batch too (operator.ts `working`). The step's early
context needs only the person and the space's eid, its narrowed directory waits
for the reach only to look past the space (grants.ts `narrowed`), and an
administrative step reads its own space's role and apps from the person's seats
and reach instead of the space's page. Measured on six warm turns in the same
conversation, `at_submit` came 145 ms after the first batch's last answer, and
now comes 40–65 ms after it, once the vault has answered the Google sign-in
client. The batch's own last answer came later, though: 0.35–0.72 s for its 14
directory requests, where the first 6 had taken 0.27–0.58 s. Its first answer
still comes at 0.11–0.39 s, which suggests the directory answers the batch's
requests one after another; that is not yet read from its own side. Time to
`at_submit` is about what it was: 0.40–0.77 s, against 0.36–0.93 s the same day.

The machine's own checks (`machineFor`) are answered from the first batch, so
`at_request` to `at_submit` is nothing.

The machine's share of stage 4, measured the same day through `/model/step` on
the machine itself, in one-word `haiku` steps 3 s apart. With one `claude`
process started for each step, first text came 858–2949 ms after the step was
sent (median 1145, ten steps). @yaks/claude now answers each step from a process
started before it (packages/claude/README.md): 612–2015 ms (median 876, ten
steps), and 1293 ms for the first step after `yak serve` starts, which finds
none waiting. The model's own time varies by more than the 0.25–0.3 s saved; the
fastest steps show it, 612 ms against 858.

What the Operator is told is two personas, worn through @yaks/persona
(operator-persona.ts). The yaks.app Operator persona is kept in the directory:
its own text is the general guidance, written by the code only where there is
none, so a person edits it there; it contains what the Operator knows because of
code (the connector guide, how its conversation and forks work), each declared
beside that code and rewritten when its text changes. Each space's own persona,
in its Operator store at the space's eid, is worn on it (`persona.base`): it
contains whose it is and what it is called, and its text is the space's to
write. The runner wears both on every ask (@yaks/harness `wear`), so an edit to
either reaches every Operator on its next turn, and `sending.instructions`
records what each ask was sent. After them come where it is: the apps in reach,
what the person has said here, and the spaces it reaches (standing.ts). What a
tool is for is said in that tool's description, where the code gives it.

Model spending reserves each provider call's maximum in the directory before
submission. The atomic reservation debits the space's shared model and voice
budget; settlement releases unused dollars once, and an uncertain submitted call
keeps its maximum unavailable until its receipt can settle. A late receipt never
resets or refunds another month's meter. Provider-reported cost exceeding the
quoted maximum is a defect, not a charge silently clamped to the cap.

Token-model bounds reserve the prompt's own input bound (@yaks/model
`promptBound`: its size, built before the call, never above the published
context window) at the most expensive input/cache tariff, then limit output to
what remains. A prompt with media, or one continuing provider-held history,
reserves the whole context window: GLM-5.3's 1,048,576 tokens at $1.40 per
million is $1.4680064. Unknown bounds refuse before generation. MiniMax music's
fixed per-track tariff is bounded; speech with post-generation-only pricing and
ElevenLabs' measured output-duration tariff require a verified bound before a
new call can be bought. Existing paid receipts remain recoverable.
