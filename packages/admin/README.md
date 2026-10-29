# @yaks/admin

Platform operations on yaks.app, exposed as `yak admin` tools by this box's
unpublished plugin. Sign-ins belong to @yaks/connections, not to admin.

## The account an operation uses

`yak auth yaks.app` signs in. Without `--as`, an operation uses the connection
whose account matches the configured person's email, else the oldest yaks.app
connection. The default is computed, never remembered; another sign-in does not
make a throwaway replace the person's account.

```sh
yak auth yaks.app
yak admin fee
yak admin query yourname/vale '.doc' --as admin@bot.yak.sh
yak admin upload probe/notes ./attachment.pdf --as probe
```

`--as` accepts the full account address or an unambiguous local part. Admin has
no account list, login, logout, use, whoami or generic tool verb, and no
`--owner` or `--admin` flags. Connector and app commands use the CLI's ordinary
command path with the same optional `--as`.

Store queries, writes, uploads, fee, client, tunnel and migration requests send
the chosen connection's bearer. The platform checks that account's existing
permissions. Infrastructure operations (`deploys`, `errors`, `tail`, `rollback`,
`revert`) use this box's Cloudflare/GitHub credentials and require the selected
account to be the platform admin or the configured person's own email. `errors`
reads through the signed tracker door configured by `@yaks/tracker` in
`tracker.json` beside this graph (or this config's own tracker plugin). The
remote URL and vault reference come from that config. It lists every unresolved
bug (not resolved or archived), however old, newest first. There is no time
window by default; `--since` optionally narrows by last seen. The header counts
the matching bugs; counts and first seen cover each bug's lifetime. Each row
says whom the bug reached: people, test accounts only, or no person recorded.
The last lines time the fixes: the median and worst time to fix (first seen, or
its regression, to resolved) of the bugs resolved in the window, a week without
`--since`, and how long the oldest open bug has been open. `--resolved` includes
each resolved bug’s full explanation, for reviewing fixes. Then people's letters
in the same window: each letter a person wrote to the platform's addresses
(bot.yak.sh, yaks.app), how many have a reply in their thread with the median
and worst time to that reply, and every one still waiting, oldest last. A letter
that needs no answer is archived (`archived{}`) to leave the list.

```sh
yak admin errors --as admin
yak admin errors --since 14d --resolved --as admin
```

## A throwaway without a browser

`throwaway` creates a random `@bot.yak.sh` address, or uses the name supplied,
and calls the same OAuth authorization as `yak auth`. Its sign-in code arrives
in this graph's mail. It never reads terminal input or stores a separate cookie
secret.

```sh
yak admin throwaway reviewer
yak admin query reviewer/notes '.doc' --as reviewer
```

Name the throwaway with `--as` for probes; a new sign-in is not a stored
selection.

## Browser-only operations

The code sign-in retains `website_session` inside the connection's private OAuth
record. Normal browser OAuth returns no website session. `delete`, `accept` and
`link` require that retained session and explain its absence rather than trying
to turn an OAuth bearer into browser authority.

```sh
yak auth yaks.app --as reviewer@bot.yak.sh
yak admin accept E-123 --as reviewer
yak admin link --days 90 --as reviewer
yak admin delete reviewer --as reviewer
```

The website's renewed cookie is written back under the same OAuth record's vault
lock. Neither the bearer nor the cookie is included in graph text or tool
answers. `delete` reads the website's list of what would be destroyed before
submitting the space's name back to its deletion form.

## OAuth clients

`yak admin client` reads the supplied 1Password references in the terminal
process and writes the client through the selected account's bearer. It is a
terminal command, so no stored call can ask a background process to read
1Password. Runtime credentials come from the box's vault.

```sh
yak admin client google 'op://vault/google/client id' 'op://vault/google/client secret' --as admin
```

## Push a directory

`push` makes an app hold exactly a directory's files and deploys them. Each
source directory, account and target remembers its **base version**: the live
version first read, or the version its last successful push deployed. The record
lives under `push/` beside the box's graph, separate from the source files. A
fresh file list leaves that base version intact.

A base version behind the live version returns the live files the deploy would
remove or replace and leaves the live version alone. After reviewing that
answer, repeat the command with `--confirm` to deploy the staged files.

A base version ahead of the live version means live went back since this
checkout deployed (a rollback through another door). The push then writes
nothing; `--confirm` deploys the directory over what is live.

```sh
yak admin push apps/mail --space reviewer --as reviewer
yak admin push apps/mail --space reviewer --as reviewer --confirm
```

## The deploy catch-up

Every push to main is meant to deploy yaks.app through Workers Builds, and
sometimes Builds starts no build for a push at all. The **deploy catch-up** is
this plugin's service: it notices main's head is not live and starts main's
build itself, and it times every deploy.

Each minute it reads main's head from origin. Once origin first showed the head
(its push, to within a look, since a commit's own time is minutes before a
land's gate lets it go) `LATE` (3 minutes; Builds queues a build within seconds
of a push) ago, it reads what `yak` serves with wrangler and compares the two
commits through the build's watch paths (workers/yak/wrangler.ts `WATCHED`), so
a push no build was meant for (a test, a README, an app) counts as live. A head
that is not live and that Builds is still building waits for its build: Builds
keeps a check run named `Workers Builds: yak` on the commit in GitHub, in
progress while the build runs, and the catch-up reads it with `gh`. A head whose
build failed waits a `BOUND` from the failure: Builds tells the kernel, which
builds main again through the deploy hook and files that build's failure
(workers/yak/builds.ts), and no check run shows that build. Any other head that
is not live, or a failed one still not live a `BOUND` on, asks main's deploy
hook for a build, and the ask leaves a `rebuilt{at, by, via, said}` mark on the
commit's entity (its eid is its sha) with what Builds answered. The hook starts
none while one is queued or initializing, so a build waiting its turn is neither
duplicated nor reported; a build it did start is reported to the tracker, tagged
with the commit, what is live and what Builds said. The hook would start a
second build beside a running one, which is why a running one is read first. A
`BOUND` (15 minutes, longer than any build measured) after the ask, still not
live, the commit gets the kernel's `failed{reason}` mark and a second report,
and no other build: its log says why. A rollback newer than the head is an
operator's choice and is left alone. Removing the marks asks for another start.

A look that reads what `yak` serves also times every deploy wrangler's
deployments list shows. A commit went live at its first deployment (one version,
naming its commit, not a rollback), and was pushed to main when GitHub made its
first check suite, which it does as the push arrives. Each is kept once, on the
commit's entity, as `deployed{pushed, live}`. When the median push to live of
the latest `WINDOW` (10) is past `SLOW` (2 minutes, about twice what a deploy
takes), the catch-up reports `deploy slow:yak`, and every deploy while it stays
slow adds a hit: deploys that got slower are a bug of their own, never main's
gate going red. When main's head goes live through its own deploy, yaks.app's
home page has to answer 200 within three tries ten seconds apart, or the
catch-up reports `deploy down:yak`.

```json
{ "use": "@yaks/admin", "with": { "hook": { "secret": "BUILD_HOOK" } } }
```

`hook` is a deploy hook of the `yak` Worker's `main` (Workers & Pages → `yak` →
Settings → Builds → Deploy hooks), a URL that can do nothing but start that
build, kept in the vault. Without one the catch-up still reports, and says no
build was started. Serve it with the box's other duties: `yak work` takes the
`@yaks/admin` role.

## The usage watch

A Worker or a Durable Object that suddenly does far more than it used to costs
money by the hour, and nothing fails while it does. The **usage watch**, the
same service's other look, reads the account's usage from Cloudflare's GraphQL
Analytics API ten minutes after each hour ends: each Worker's requests and CPU
time, and each Durable Object's requests, rows read, rows written and duration.
An hour is **past its normal** when it is at least twice its subject's normal,
the median of the 48 hours before, and past it by the metric's floor, about a
cent an hour (`METRICS` in usage.ts). A **jump** is an hour past its normal
whose run of hours past it has lasted three hours, so the rise stays, or is past
its normal by 24 floors in all, so it is worth a look even once. An hour of work
that finished is neither, and is not reported. A jump is reported to the box's
tracker as a bug, one per subject and metric, saying the amount, the normal, how
long it has run, the Worker, the object and, for an object, its entry points
that hour (fetch, alarm, RPC):

> yak-tracker's Durable Object 1711faaf1a26 read 423.8M rows in the hour from
> 2026-10-17T12:00:00.000Z, 129.1 times its normal of 3.3M an hour, the median
> of the 48 before (Cloudflare's analytics). It has been past its normal 2 hours
> running. Its entry points: 3,119 alarm, 3,100 http, 98 jsrpc.

The watch keeps nothing: Cloudflare holds the history, and an hour's report has
an eid derived from the hour, so a look repeated after a restart lands once. It
reports through the box's spool, never through the platform tracker's Worker, so
a jump in that tracker is still heard.

A look that fails is tried again five minutes later, for the same hour. A query
Cloudflare fails on its own side (a 5xx or a 429) is sent again within each look
(workers/yak/workers_api.ts `resent`), and a look it fails through every resend
is a log line; once Cloudflare has not answered for five minutes, the outage is
reported once, with the last failure as its cause. Any other failure, such as a
token refused 401 or 403, is reported at once. Either is one report until a look
succeeds.

```json
{
  "use": "@yaks/admin",
  "with": {
    "hook": { "secret": "BUILD_HOOK" },
    "analytics": { "secret": "CF_USAGE_TOKEN" },
    "account": "0f9613dfd3f0451df0bd0f12a1372ea3"
  }
}
```

`analytics` is an account-owned Cloudflare token with Account Analytics Read
alone, read at each hour's look; an hour whose look finds no token is passed
over, and without `account` there is no usage watch.

## Facets

- `./vocab` declares the admin tools, the `rebuilt` mark and `deployed`.
- `./tools` implements those tools over the host's graph, config and vault.
- `./cli` binds the account selector to the admin tools' `as` input.
- `./service` is the deploy catch-up and the usage watch.
- The root exports the platform API helpers, tools and vocabulary.
