// The kernel's bindings (wrangler.toml), typed structurally — the slice each
// binding is asked for, mirroring @cloudflare/workers-types — so `deno check`
// reads the Worker without the package and nothing under src/ learns a
// Cloudflare name.
//
// Each part of the kernel is a module exporting a plain `fetch(req, env)`
// (identity.ts, mcp.ts, directory.ts, apps.ts), and the router (index.ts)
// composes them by calling those handlers. The optional service bindings
// below are the seam for moving a part into its own Worker: declare the
// binding in wrangler.toml and the router calls it instead of the module,
// with no other change. A part never reaches another except through its
// handler, and none keeps state another reads.
import type { R2 } from '../../src/blobs_r2.ts'
import type { Dispatch } from './dispatch.ts'
import type { Binding } from './post.ts'
import type { Fetcher, Namespace } from './door.ts'

// The door's own word, said again here: every part of this kernel names its
// bindings out of env.ts, and where a request may be handed is the door's to
// define (door.ts) so that a Store object can hold one without holding this.
export type { Fetcher }

// One inbound message, as Email Routing hands it to `email()` (index.ts).
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

export type Env = {
  STORE: Namespace
  // The person's own MCP stream (stream.ts): one object per signed-in
  // person, holding what an open connector is listening to.
  WIRE: Namespace
  // Cloudflare's per-deploy version id (wrangler.toml [version_metadata]):
  // `id` changes on every `wrangler deploy`, so the stream compares it to know
  // the platform moved (stream.ts, T-33013). Optional — the binding is absent
  // under `wrangler dev` and the workerd probes, so nothing may depend on it.
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string }
  ASSETS: Fetcher
  BLOBS: R2
  // Where a Store writes its whole old graph before it migrates (migrate.ts,
  // T-33809): one object per pass, kept, and the only restore path there is.
  // Optional in the type and NOT optional in effect — a store with no bucket
  // bound refuses to move a row and serves its old rows read-only — because the
  // bucket has to exist on the account before the cutover deploy (T-33808).
  EXPORTS?: R2
  // The session-signing secret; unset, no session verifies (token.ts). It
  // also keys the sign-in code digests (signin.ts).
  SESSION_SECRET?: string
  // The OAuth provider's own store — clients, grants, tokens. Its shape is
  // the library's (identity.ts); nothing in the kernel reads it, so `unknown`
  // keeps a Cloudflare type name out of here.
  OAUTH_KV: unknown
  // Whether we claim Client ID Metadata Documents (identity.ts `cimd`). On
  // unless it says `off`; read per request, so dropping the claim is one
  // `wrangler secret put` and no deploy of new code.
  CIMD?: string
  // The mail seam (mail.ts). MAIL_DEV=1 files a letter in the meta store
  // instead of sending it — local runs only. The other three are Cloudflare
  // Email Sending: the API token, the account, and a base URL a probe aims
  // somewhere else.
  MAIL_DEV?: string
  MAIL_TOKEN?: string
  MAIL_ACCOUNT?: string
  MAIL_API?: string
  // The same product, reached the other way: Email Sending as a BINDING
  // rather than the REST API (wrangler.toml `[[send_email]]`, T-33684). No
  // token rides with it — the deploy is the authorization — so it is what an
  // APP's own address sends on (post.ts, T-33686): the Store is handed this
  // whole env and reads this one binding out of it. Absent under `wrangler
  // dev` without `remote = true` and in the workerd probes, where a letter
  // bounces saying so; mail.ts still speaks the REST API, because the
  // platform's own sign-in codes go out from bot.yak.sh rather than an app's
  // address.
  MAIL?: Binding
  // The meter (usage.ts): a Cloudflare API token that may read the account's
  // analytics, and the account it reads. The token is a secret the owner sets
  // (T-32759) and unset the hourly sweep does nothing; the account tag is not
  // a secret and rides wrangler.toml's `[vars]`.
  CF_ANALYTICS_TOKEN?: string
  CF_ACCOUNT?: string
  // An app's OWN code (dispatch.ts): the Workers for Platforms namespace its
  // worker.js is uploaded into, and the token the upload speaks to the
  // Workers API with — the account tag above is the same one. The namespace
  // has no local implementation — it is remote-only — so under `wrangler dev`
  // the binding is undefined and every app serves its files. The token is the
  // owner's (T-32781); without it an app with a worker deploys its files and
  // is told so.
  DISPATCH?: Dispatch
  CF_WORKERS_TOKEN?: string
  // A person's own domain (domains.ts, T-33038): the yaks.app zone the
  // Cloudflare for SaaS custom hostnames are created on — not a secret, it
  // rides wrangler.toml's `[vars]` beside the account tag — and a token that
  // may edit that zone's SSL and certificates, which is the owner's to set.
  // Unset, the domain tools refuse saying which is missing; nothing is ever
  // half-attached.
  CF_ZONE?: string
  CF_HOSTNAMES_TOKEN?: string
  // The paid tier (billing.ts, T-33125). STRIPE_KEY is the restricted API key
  // checkout, the portal and one subscription read speak to Stripe with;
  // STRIPE_WEBHOOK_SECRET is what the events Stripe posts are verified
  // against. Both are secrets and both are the owner's to set (T-32760);
  // unset, the doors say the paid tier is not switched on here rather than
  // half-working. STRIPE_PRICE is the recurring price a subscription is for —
  // not a secret, it rides wrangler.toml's `[vars]` beside the account tag —
  // and STRIPE_API is the base URL a probe aims somewhere other than Stripe.
  STRIPE_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE?: string
  STRIPE_API?: string
  // The builder (builder.ts, T-34239): the model that makes somebody their
  // first app. Workers AI is the free build — `AI` is the binding
  // (wrangler.toml `[ai]`), no key of ours, and absent under the workerd
  // probes, where the loop says so rather than half-running. OpenAI is the
  // paid one, reached through the AI Gateway: AI_GATEWAY names the gateway on
  // the account above, and either key opens it — OPENAI_API_KEY as ours, or
  // AI_GATEWAY_TOKEN as the gateway's own stored one (T-34238). Both secrets;
  // unset, the paid build refuses in a sentence naming that ticket.
  // OPENAI_API is a probe's door to somewhere other than the gateway.
  // BUILDER_MODEL_FREE and BUILDER_MODEL_PAID are the model ids, so changing
  // either is a `wrangler secret put` and no deploy of new code.
  AI?: {
    run(model: string, input: unknown, opts?: unknown): Promise<unknown>
    gateway(id: string): { getUrl(provider?: string): Promise<string> }
  }
  AI_GATEWAY?: string
  AI_GATEWAY_TOKEN?: string
  OPENAI_API_KEY?: string
  OPENAI_API?: string
  BUILDER_MODEL_FREE?: string
  BUILDER_MODEL_PAID?: string
  // The single static token OpenAI's apps directory fetches to verify the
  // domain (index.ts serves it at /.well-known/openai-apps-challenge). A
  // secret so the open-source repo carries no token; unset, that path 404s.
  OPENAI_APPS_CHALLENGE?: string
  // A part split into its own Worker, when it has been; absent, in-process.
  IDENTITY?: Fetcher
  MCP?: Fetcher
  BILLING?: Fetcher
  DIRECTORY?: Fetcher
  APPS?: Fetcher
  // The one binding that is not a part waiting to be split out: `Files` is a
  // SECOND entrypoint of this same Worker (index.ts), bound here so that
  // Cloudflare's cache sits between the gateway and the bucket (cache.ts,
  // T-33197). Absent under `wrangler dev` and the workerd probes, where
  // `bound` calls the module in-process and nothing is cached.
  FILES?: Fetcher
}

// One part's handler shape: a request and its env, nothing else.
export type Handler = (req: Request, env: Env) => Promise<Response>

// The part as a Fetcher: the service binding when it exists, else the module
// called in-process with this env.
export let bound = (binding: Fetcher | undefined, handle: Handler, env: Env) =>
  binding ?? { fetch: (req: Request) => handle(req, env) }
