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

Rollback is `npx wrangler rollback` to the prior version, remembering that a
Durable Object already migrated stays on the new schema.

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
| Deploy command          | `npx wrangler deploy`                                                        |
| Build watch paths       | `workers/yak/*`, `packages/*`                                                |
| Non-production branches | build only, no deploy — preview URLs do not apply to a Durable Object Worker |

Everything the build actually does is in `bin/build-yak`, so the dashboard holds
one line: install Deno (not on the Ubuntu 24.04 image), `deno task check` from
the repo root, `deno test -A workers/yak/`. A red build deploys nothing.

## ANALYTICS_TOKEN — the one secret only the owner can mint

"Who visited" on a space page, `<space>.yaks.app/<app>/api/stats` and the
`app_stats` tool all read Workers Analytics Engine through its SQL API, which
takes a **bearer token** rather than a binding — there is no read binding for a
dataset. Nobody but the account's owner can create one. Until it is set the
three doors say analytics are not switched on yet, in one sentence, and nothing
errors; writing the data points needs none of this and is already happening.

The dashboard steps, in full — a **new, finely scoped** token, never an existing
one (M-4524):

| step | where                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 1    | dash.cloudflare.com → the profile menu (top right) → **API Tokens**                                      |
| 2    | **Create Token** → scroll to the bottom → **Create Custom Token** → Get started                          |
| 3    | Token name: `yak analytics read`                                                                         |
| 4    | Permissions: **Account** · **Account Analytics** · **Read** — that one row and no other                  |
| 5    | Account Resources: **Include** · the account `yak` runs on (`0f9613df…`)                                 |
| 6    | Client IP Address Filtering: leave empty. TTL: leave empty (no expiry), or set one and diary the renewal |
| 7    | **Continue to summary** → **Create Token** → copy the value once; it is never shown again                |

Then, from `workers/yak`:

```sh
npx wrangler secret put ANALYTICS_TOKEN   # paste the token
```

`CF_ACCOUNT` is already in `wrangler.toml` `[vars]`, so nothing else is needed.
It is a **different** token from `CF_ANALYTICS_TOKEN`, which the meter uses —
the same permission, a separate token, so revoking one does not stop the other.

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
