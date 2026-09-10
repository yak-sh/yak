# yaks.app incident paging

`yak-tail` consumes the kernel's Tail events. It records exception outcomes from
every kernel entrypoint, and `console.error` from `Store` and the default
entrypoint. Dispatched apps have their own exception reporting and are ignored.

The signature is SHA-256 of the exception name, message with numbers/UUIDs/
object IDs normalized, first stack frame, and entrypoint. The frame keeps its
function and file so separate throw sites stay separate, and drops its
`line:col`, which the bundle moves on every deploy — one defect is one signature
across deploys, not one per version. Missing runtime version, stack, or request
information stays missing; the producer's `scriptVersion.id` is the version in
the page. URLs use Cloudflare's redacted form.

The native `MAIL` binding sends the page directly, without depending on the
kernel's Store. A page writes from `yaks.app incidents
<incidents@bot.yak.sh>`
(`mail-config.ts` `INCIDENTS`), so a mailbox rule can sort incidents away from
the platform's own letters; the subject is
`[yaks.app] <entrypoint>: <name>: <first line>`. `YAK_OWNER_EMAIL` overrides the
existing owner forwarding address in `workers/yak/mail-config.ts`; set it
through `wrangler secret put` if needed. No owner address or mail credential
belongs in this worker's configuration.

## The incident reader contract (T-34701)

KV namespace `yak-incidents`, id `df2f9db77ee0426184909a77273bc09a`, is bound as
`SEEN`. List keys with prefix `incident/`, then read each JSON value:

```ts
{
  signature: string, // also the suffix of incident/<signature>
  version: string | null, // first event's producer version
  first: number, // epoch milliseconds
  last: number, // epoch milliseconds
  count: number, // invocations with this signature in the outage
  sample: {
    name: string,
    message: string,
    stack: string,
    entrypoint: string,
    url: string | null // first event's URL
  }
}
```

Thirty minutes without the signature ends the outage. Every repeated event
updates `last`/`count`; a continuing boot loop does not page again after thirty
minutes. The next outage replaces the row's first/sample/version/count. Rows
have no TTL, so an incident is still readable after recovery. KV metadata
`paged` records whether mail was accepted; a failed mail still writes the
incident and retries on the next matching event.

One invocation contributes at most one occurrence of each signature. Concurrent
batches in one isolate coalesce; writes to the same key are spaced by a second,
and KV 429 responses are retried. KV has no atomic conditional write and is
eventually consistent: simultaneous isolates can duplicate a page or overwrite
count increments. This prescribed KV-only design cannot promise global
exactly-once delivery. See
[KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/).

## Deploy

```sh
deno task deploy:yak-tail --dry-run
deno task deploy:yak-tail
```

The task uses the kernel's pinned Wrangler and this directory's `wrangler.toml`.
There are no Durable Objects and no public HTTP route. The namespace was created
with Wrangler and its id is recorded above and in `wrangler.toml`.

`bin/build-yak` checks both workers. Deploy the tail separately before deploying
the kernel: Workers Builds pins its deploy command to the configured Worker's
identity (`WRANGLER_CI_MATCH_TAG`), and feature branches also run the build
command. The build therefore remains a gate; it does not bypass that identity
guard to deploy a second Worker. Tail changes require
`deno task deploy:yak-tail`.

The kernel's `[[tail_consumers]]` keeps the attachment on future deploys. To
attach an already deployed tail without uploading kernel code, GET then PATCH
`/accounts/<account>/workers/scripts/yak/script-settings`, preserving existing
consumers and adding `{"service":"yak-tail"}` to `tail_consumers`. Verify the
settings and that the kernel deployment version is unchanged. A deployment from
an older commit without the consumer can remove this live attachment.

## Box watchdog

`bin/yak-watch` runs `bin/verify-deploy.ts --tail 0` plus the fixed app list in
`workers/yak/watch.json` every five minutes (`etc/yak-watch.cron`). Run
`bin/yak-watch --probe` for a read-only check. The verifier has a 30-second
deadline; each app probe and mail send has a 10-second deadline.

Public apps must answer 200. The explicitly private `mom/recipe-box` must answer
its exact login redirect; that checks the private app's routing, not its
authenticated page. `/connect` likewise checks its deliberate login redirect.

The watchdog reads the box's existing `CLOUDFLARE_EMAIL_TOKEN` and
`HOLDCO_CF_ACCOUNT_ID` from the environment or holdco's `.env`. `YAK_WATCH_ENV`
selects another config file; `YAK_OWNER_EMAIL` selects the owner. A locked,
atomically written `~/.tasks/yak-watch.json` pages once per continuous outage,
rearms on an all-green pass, and retries rejected mail. `YAK_WATCH_STATE` can
override that path for testing.

Register `yak-watch` with `holdco-deadman` at 15 minutes before installing the
cron. A completed check, including a successfully paged outage, stamps the
deadman; a broken monitor or failed mail does not. The checked-in cron uses the
main checkout. The initial live cron uses main once `bin/yak-watch` is present,
falling back to the reviewed worktree until this commit lands. No main-checkout
files need to be changed to activate monitoring during review.
