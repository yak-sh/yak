import type { ServingCopies } from './directory-copy.ts'
// The kernel's bindings (wrangler.toml), typed structurally — the slice each
// binding is asked for, mirroring @cloudflare/workers-types — so `deno check`
// reads the Worker without the package and nothing under src/ learns a
// Cloudflare name.
//
// Each part of the kernel is a module exporting a plain `fetch(req, env)`
// (identity.ts, mcp.ts, directory.ts, apps.ts), and the router (kernel.ts)
// composes them by calling those handlers. The optional service bindings
// below are the seam for moving a part into its own Worker: declare the
// binding in wrangler.toml and the router calls it instead of the module,
// with no other change. A part never reaches another except through its
// handler, and none keeps state another reads.
import type { Bucket, Multipart } from '@yaks/blob'
import type { D1Like } from '@yaks/d1'
import type { Dispatch, Fetcher } from './door.ts'
import type { Namespace } from '@yaks/durable-object/door'
import type { Meta } from './meta.ts'
import type { Purgers, Purges } from './purge.ts'
import type { Outlasts } from './outlast.ts'
import type { Lexicons } from './lexicon.ts'
import type { Limiter } from '@yaks/workerd/rate'
import type { Sandboxes } from '@yaks/sandbox/cloudflare'
import type { Workspaces } from './workspaces.ts'
import type { Inference } from '@yaks/model'
import type { Clock } from '@yaks/fp'
import type { Strip } from '@yaks/esbuild'

// The door's own word, said again here: every part of this kernel names its
// bindings out of env.ts, and where a request may be handed is the door's to
// define (door.ts) so that a Store object can hold one without holding this.
export type { Fetcher }

// One inbound message, as Email Routing hands it to `email()` (facets/kernel-worker.ts).
// The slice we read: who the envelope said it was from and for, the letter's
// own headers and bytes (inbox.ts parses the MIME), and the one way to refuse
// it — a refusal bounces to the sender, where a drop is silence.
//
// `setReject` is awaited: across the runtime's own RPC boundary it answers a
// promise, and a rejection that is not awaited can land after the message is
// already accepted.
export type Inbound = {
  from: string
  to: string
  headers: { get(name: string): string | null }
  raw: ReadableStream
  setReject(reason: string): void | Promise<void>
}

// The slice of Cloudflare's Images binding we use: bytes in, one format out.
// It refuses a format it can't read with an ImagesError whose code is 9520.
export type Images = {
  input(stream: ReadableStream<Uint8Array>): {
    output(o: { format: string }): Promise<{ response(): Response }>
  }
}

/** What a test hands a kernel as its environment: any of Env's bindings, and
 * the secrets a config names, which are read by name (config.ts
 * `phoneConfig`). */
export type Vars = Partial<Env> & Record<string, unknown>

export type Env = {
  LOADER?: import('./code-runtime.ts').Loader
  CODE_MODE?: import('@yaks/code-mode').Evaluate
  // Platform defects and triggered Store traces, through independent intake.
  ERRORS?: { send(rows: import('@yaks/graph').Bundle[]): Promise<void> }
  ENVIRONMENT?: string
  TRACKER?: Fetcher
  TRACKER_SECRET?: string
  // Explicitly disable recording, primarily for isolated cost comparisons.
  STORE_TRACING?: string
  MODEL_FETCH?: typeof fetch
  // New asks use this independently deployed executor only once it is live.
  MODEL?: {
    submit(job: Inference): Promise<void>
    version(): Promise<{ executor: string; id?: string }>
  }
  MODEL_RECEIPTS?: Bucket
  APEX?: string
  // Local loopback probes may supply x-yak-host; never set on a deploy.
  LOCAL_DEV?: string
  // The time the kernel keeps and its waits (@yaks/fp `Clock`); unset, the
  // runtime's. Only a test sets it, so it moves its own kernel's time instead
  // of the runtime's, which every test in the process shares.
  CLOCK?: Clock
  STORE: Namespace
  // The directory's store answered in-process, set only by the object that IS
  // the directory for the jobs it runs (graph.ts, meta.ts `meta`). Absent, the
  // directory is reached through its stub like every other store.
  META?: Meta
  // The person's own MCP stream (stream.ts): one object per signed-in
  // person, holding what an open connector is listening to.
  WIRE: Namespace
  // The builder's conversation (build.ts, T-34240): one object per space,
  // holding what has been said there and running one build at a time, with
  // the space's page listening on a socket.
  BUILDER: Namespace
  // Cloudflare's per-deploy version id (wrangler.toml [version_metadata]):
  // `id` changes on every `wrangler deploy`, so the stream compares it to know
  // the platform moved (stream.ts, T-33013). Optional — the binding is absent
  // under `wrangler dev` and the workerd probes, so nothing may depend on it.
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string }
  ASSETS: Fetcher
  BLOBS: Bucket & Multipart
  // The session-signing secret; unset, no session verifies (token.ts). It
  // also keys the sign-in code digests (signin.ts).
  SESSION_SECRET?: string
  // The OAuth provider's own store — clients, grants, tokens. Its shape is
  // the library's (identity.ts); nothing in the kernel reads it, so `unknown`
  // keeps a Cloudflare type name out of here.
  OAUTH_KV: unknown
  // Where a connection's credential is kept (vault.ts): the D1 database of
  // the vault (wrangler.toml `[[d1_databases]]`), and the key every value in
  // it is encrypted under — 32 bytes in base64, a secret. Either unset, a
  // key cannot be saved and the connections page says so.
  VAULT?: D1Like
  VAULT_KEY?: string
  // yaks.app's VAPID key, the JWK of a P-256 private key that signs every
  // browser notification (operator-alerts.ts `vapidOf`, @yaks/push). Unset,
  // the Operator page offers no browser notifications.
  PUSH_VAPID_KEY?: string
  // Whether we claim Client ID Metadata Documents (identity.ts `cimd`). On
  // unless it says `off`; read per request, so dropping the claim is one
  // `wrangler secret put` and no deploy of new code.
  CIMD?: string
  // The mail seam (mail.ts). MAIL_DEV=1 files a letter in the meta store
  // instead of sending it — local runs only. Unset credentials for the
  // selected sender: `mailable` says no and the sign-in door answers 503 in
  // one sentence.
  MAIL_DEV?: string
  // Staging keeps every outbound letter in the owner's inbox.
  MAIL_SINK?: string
  // Provider selection changes only after the configured addresses pass pilots.
  MAIL_VIA?: string
  // What the mail providers config.ts names (`posts`) read, each by its name
  // there: Resend's two sending keys, its webhook's signing secret and API
  // root, and Cloudflare Email Sending's token and API root (its account is
  // CF_ACCOUNT). A probe
  // aims an API root somewhere else, and calls through MAIL_FETCH.
  // RESEND_DOMAINS_TOKEN is the `full_access` key `mailDomains` there sets up
  // a space's mail domains with, and that reads the letters Resend receives.
  RESEND_WEBHOOK_SECRET?: string
  RESEND_TOKEN?: string
  RESEND_PLATFORM_TOKEN?: string
  RESEND_DOMAINS_TOKEN?: string
  RESEND_API?: string
  MAIL_FETCH?: (url: string, init: RequestInit) => Promise<Response>
  MAIL_TOKEN?: string
  MAIL_API?: string
  // The same Email Sending, reached the other way: a binding rather than the
  // REST API (wrangler.toml `[[send_email]]`, T-33684). No token rides with
  // it — the deploy is the authorization — so it is what an app's own address
  // sends on by default (post.ts, T-33686). The Worker never calls it; it
  // lends it to the provider config.ts names. Absent under `wrangler dev`
  // without `remote = true` and in the workerd probes, where no `binding`
  // sender is lent.
  MAIL?: object
  // Account Analytics Read serves every analytics read (@yaks/cloudflare/analytics): the
  // meter (usage.ts), the kill sweep (kills.ts) and page visits (views.ts).
  // CF_ACCOUNT is public and configured in wrangler.toml. ANALYTICS_API aims
  // all of them somewhere other than Cloudflare, for a probe.
  CF_ANALYTICS_TOKEN?: string
  CF_ACCOUNT?: string
  ANALYTICS_API?: string
  // REST APIs name these resources explicitly; bindings alone cannot keep
  // app uploads and analytics reads on this deployment.
  WORKER_NAME?: string
  DISPATCH_NAMESPACE?: string
  VIEWS_DATASET?: string
  // Who visited an app (views.ts, T-34496): the Analytics Engine dataset one
  // data point per page view is written to. The SQL API reads it with the
  // account and analytics token above. The binding is absent under the
  // workerd probes and the in-memory harness, where a view is counted nowhere
  // and nothing says so; the token unset, the space page says analytics are
  // not switched on rather than failing.
  VIEWS?: {
    writeDataPoint(point: {
      indexes?: string[]
      blobs?: string[]
      doubles?: number[]
    }): void
  }
  // The per-source ceilings on the doors a stranger can knock on (@yaks/workerd/rate,
  // wrangler.toml `[[ratelimits]]`): sign-in code requests, OAuth client
  // registration, anonymous connector calls, anonymous feedback, and anonymous
  // requests for an app's data (its `/api/` doors), and a visitor's knocks on
  // an app's voice door (rtc.ts), and a stranger's first write at a published
  // app, which makes them a store (visit.ts). Absent in the in-process
  // harness, where nothing is limited.
  SIGNIN_RATE?: Limiter
  REGISTER_RATE?: Limiter
  TOOL_RATE?: Limiter
  FEEDBACK_RATE?: Limiter
  API_RATE?: Limiter
  RTC_RATE?: Limiter
  BIRTH_RATE?: Limiter
  // An app's own code (dispatch.ts): the Workers for Platforms namespace its
  // worker.js is uploaded into, and the token the upload speaks to the
  // Workers API with — the account tag above is the same one. The namespace
  // has no local implementation — it is remote-only — so under `wrangler dev`
  // the binding is undefined and every app serves its files. The token is the
  // owner's (T-32781); without it an app with a worker deploys its files and
  // is told so. The same token uploads the gateway of each space's tunnel
  // (tunnel.ts), which binds a VPC Service, so it also holds the Connectivity
  // Directory Bind role.
  DISPATCH?: Dispatch
  CF_WORKERS_TOKEN?: string
  // The account API is directed to the probe's Cloudflare stand-in in tests.
  WORKERS_API?: string
  // What makes and removes a space's tunnel and its Workers VPC Service
  // (tunnel.ts): Cloudflare Tunnel Write and the Connectivity Directory Admin
  // role on this account. Without it a space can still be linked to a
  // machine the owner already has a tunnel for (`adopt`); nothing new is made.
  CF_TUNNEL_TOKEN?: string
  // The deploy hook that builds `main` again after a push's build failed
  // (builds.ts): a URL whose path is its own credential, scoped to this
  // Worker's production branch and able to do nothing but start a build.
  // Production's alone, like the queue that uses it.
  BUILD_HOOK?: string
  // User-scoped Workers CI Read token for the failed-build queue consumer.
  // It reads the build log before reporting a safe summary to the tracker.
  BUILD_LOG_TOKEN?: string
  // A person's own domain (domains.ts, T-33038): the yaks.app zone the
  // Cloudflare for SaaS custom hostnames are created on — not a secret, it
  // rides wrangler.toml's `[vars]` beside the account tag — and a token that
  // may edit that zone's SSL and certificates, which is the owner's to set.
  // Unset, the domain tools refuse saying which is missing; nothing is ever
  // half-attached.
  CF_ZONE?: string
  CF_HOSTNAMES_TOKEN?: string
  // And the base URL those calls go to, which a probe aims somewhere other
  // than Cloudflare — the same seam MAIL_API is, and for the same reason:
  // attaching a domain is a conversation, and the test that holds it must be
  // able to have it.
  HOSTNAMES_API?: string
  // DNS-over-HTTPS JSON endpoint for hostname ownership TXT lookups.
  DNS_API?: string
  // The paid tier (billing.ts, T-33125) and selling (sell.ts) are the payment
  // provider config.ts `payments` names: its key, prices and webhook secrets
  // are the secrets and `[vars]` its entry reads from this environment by
  // name, so none is named here.
  //
  // Texts and calls (phones.ts): the phone provider the platform sends from,
  // by the name its plugin lends it under, and the number it sends from. Each
  // provider's credentials are the secrets its entry in config.ts
  // `phoneConfig` names, read from this environment by name.
  PHONE_SENDER?: { via: string; number?: string }
  // Speech (speech.ts, T-140123): each provider's key is a secret of its own,
  // DEEPGRAM_API_KEY for Deepgram and OPENAI_VOICE_KEY for OpenAI (its
  // "yaks.app voice" project, held to $10 a month while it is a pilot,
  // T-140668); a provider whose key is unset is off. SPEECH_FLOOR, a `[vars]`
  // line, is the credit left on an account that says its balance (Deepgram's)
  // below which speech is refused while it is a pilot. SPEECH_API aims every
  // provider elsewhere, for a test.
  DEEPGRAM_API_KEY?: string
  OPENAI_VOICE_KEY?: string
  // The signing secret of the webhook a provider whose own line carries
  // calls rings when one comes in (speech.ts LINES, operator-carried.ts).
  OPENAI_CALLS_SECRET?: string
  SPEECH_FLOOR?: string
  SPEECH_API?: string
  // `on` signs up a stranger who texts the platform's number
  // (operator-texts.ts `signedUp`); anything else leaves their text unread.
  // Off until the toll-free verification covers it (T-138775). Read per text,
  // so it is one `wrangler secret put` and no deploy, as CIMD is.
  TEXT_SIGNUP?: string
  // The builder (builder.ts, T-34239): the model that makes somebody their
  // first app. Both tiers run on Workers AI — `AI` is the binding
  // (wrangler.toml `[ai]`), no key of ours and nothing bought, absent under
  // the workerd probes where the loop says so rather than half-running.
  // The four beside it are OpenAI's (config.ts `openai`), which nobody has
  // switched on: the AI Gateway named by AI_GATEWAY, paid for by
  // OPENAI_API_KEY or by the gateway's own stored key (AI_GATEWAY_TOKEN), and
  // OPENAI_API, a probe's door to somewhere other than the gateway. Which
  // provider the builder runs on is config.ts `agents`. BUILDER_MODEL_FREE and
  // BUILDER_MODEL_PAID are the model ids, so changing either is a `wrangler
  // secret put` and no deploy of new code.
  AI?: {
    run(model: string, input: unknown, opts?: unknown): Promise<unknown>
    gateway?(id: string): { getUrl(provider?: string): Promise<string> }
    toMarkdown?: import('./documents.ts').Markdown
  }
  AI_GATEWAY?: string
  AI_GATEWAY_TOKEN?: string
  OPENAI_API_KEY?: string
  // Optional key scoped to OpenAI text models for Operator conversations.
  // The shared OPENAI_API_KEY remains the image service's credential.
  OPENAI_OPERATOR_API_KEY?: string
  // The "yaks.app models" project's key, limited to the OpenAI models that
  // answer the chat names apps ask ./api/ai/run for (config.ts `answering`).
  OPENAI_MODELS_KEY?: string
  OPENAI_API?: string
  BUILDER_MODEL_FREE?: string
  BUILDER_MODEL_PAID?: string
  OPERATOR_MODEL?: string
  // Claude for the Operator and builders (providers.ts): the platform's
  // Anthropic key, for product use only. With it the Operator runs on Sonnet
  // and hands coding to OPERATOR_DELEGATE (Opus by default).
  ANTHROPIC_API_KEY?: string
  OPERATOR_DELEGATE?: string
  // The builder's workbench (sandbox.ts, T-34264): the Cloudflare Container
  // one build compiles in, bound as yak-sandbox's Durable Object namespace
  // (sandbox/wrangler.toml). Absent in a test run and the
  // workerd probes, where the sandbox tools say so rather than half-running,
  // and unanswered under `wrangler dev`, where yak-sandbox is not running.
  WORKBENCH?: Sandboxes
  // yak-browser, which renders a draft for app_preview in Cloudflare's
  // browser (browser.ts), including under local dev. Absent in a test run and
  // the workerd probes.
  BROWSER?: Fetcher
  WORKSPACES?: Workspaces
  // The single static token OpenAI's apps directory fetches to verify the
  // domain (apex.ts serves it at /.well-known/openai-apps-challenge). A
  // secret so the open-source repo carries no token; unset, that path 404s.
  OPENAI_APPS_CHALLENGE?: string
  // Meta's Conversions API (meta-ads.ts): the dataset a page seen and a
  // sign-up its ad's click brought are sent to, the token for that dataset
  // alone (a secret), and, while set, the Events Manager test code that files
  // them as test events. Without the dataset and token Meta is told nothing.
  META_DATASET?: string
  META_CONVERSIONS_TOKEN?: string
  META_TEST_CODE?: string
  // Where they are sent, when a probe aims them away from Meta.
  META_API?: string
  // A part split into its own Worker, when it has been; absent, in-process.
  IDENTITY?: Fetcher
  MCP?: Fetcher
  BILLING?: Fetcher
  // Independent public-only read fallback, never a source of signed-in standing.
  SERVING_COPY?: ServingCopies
  DIRECTORY?: Fetcher
  APPS?: Fetcher
  // The one binding that is not a part waiting to be split out: `Files` is a
  // second entrypoint of this same Worker (facets/kernel-worker.ts), bound here so that
  // Cloudflare's cache sits between the gateway and the bucket (cache.ts,
  // T-33197). Absent in a test run; there, and wherever Cloudflare
  // refuses the hop, files.ts `door` reads the module in-process and nothing
  // is cached.
  FILES?: Fetcher
  // The cached public pages behind the uncached gateway (site.ts): the apex's
  // home and gallery, and every public page an app serves. Its `purge` takes
  // pages out of its cache (purge.ts); the in-process stand-in has none, and
  // no cache either.
  SITE?: Fetcher & Partial<Purges>
  // The one object every purge of Site's cache goes through (facets/kernel-worker.ts
  // `Purger`), keeping the account's purge budget. Bound where Site's cache
  // is on; a test run binds none, so nothing is purged.
  PURGER?: Purgers
  // The objects a call that outlasts its caller runs in (outlast.ts, facets/kernel-worker.ts
  // `Outlast`). A test run binds none, so every call runs in its request.
  OUTLAST?: Outlasts
  // The object holding every app store's lexicon, which a search asks before
  // waking stores (lexicon.ts, facets/kernel-worker.ts `Lexicon`). A test run binds none
  // unless it asks, and then every store is asked.
  LEXICON?: Lexicons
  // yak-esbuild, whose container compiles an app's TypeScript and npm imports
  // at deploy, and which strips TypeScript to JavaScript for the module walk
  // and code mode, so sucrase is in its upload and not this one (esbuild.ts
  // `stripping`). Absent in a test run and the workerd probes.
  ESBUILD?: Fetcher & { strip: Strip }
  // Cloudflare Images (wrangler.toml `[images]`), which converts a picture
  // the vision model can't read to one it can (documents.ts `legible`).
  // Absent in a test run and the workerd probes.
  IMAGES?: Images
  // yak-raster, which draws an app's icon.svg as its icon.png (raster.ts).
  // Absent in a test run and the workerd probes.
  RASTER?: Fetcher
  // Voice (rtc.ts): the platform's one Cloudflare Realtime SFU app, its id and
  // its secret, and one TURN key and its token. All four are secrets, kept in
  // 1Password beside each other. REALTIME_API is a probe's door to somewhere
  // other than rtc.live.cloudflare.com. Unset, every app's ./api/rtc/ answers
  // that voice is not switched on here.
  REALTIME_APP?: string
  REALTIME_TOKEN?: string
  TURN_KEY?: string
  TURN_TOKEN?: string
  REALTIME_API?: string
}

// One part's handler shape: a request and its env, nothing else.
export type Handler = (req: Request, env: Env) => Promise<Response>

// The part as a Fetcher: the service binding when it exists, else the module
// called in-process with this env.
export let bound = (binding: Fetcher | undefined, handle: Handler, env: Env) =>
  binding ?? { fetch: (req: Request) => handle(req, env) }
