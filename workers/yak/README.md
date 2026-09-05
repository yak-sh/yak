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
