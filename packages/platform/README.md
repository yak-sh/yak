# @yaks/platform

Defines graph components for a hosting platform's applications, deployments,
customer spaces, billing usage, sign-ins, and error reports. It also compares
releases and holds the names and rules the platform and its clients share,
without storage or runtime calls, and serves one app's release on this machine
(`yak release serve`); it is not a deployment server or billing implementation.

`space` is what a customer owns; `app` is what lives in it; `deploy` is one
release of that app, and `published` is the name it was released under;
`hostname` is a domain pointed at a space or an app, and `mail_domain` on it (or
on a space, for its subdomain) where its mail is and which provider carries it;
`installed` records the source app and version of a copy, `install` that a space
took one, credited to the space that shared it, and `upstream` where something
someone outside the platform wrote came from and under which licence; `plan` is
what is being paid for, a mirror of one Stripe subscription, and `meter` is the
usage it is billed on; `signin` is a sign-in in progress, and `report` is an
error a deployed app reported. `operator{name}` on a space is what its Operator
is called, a copy of its persona's title for what reads the space without the
Operator's store; its other properties are retired, read only by a store moving
its persona from before they were the persona's.

yaks.app's directory (`workers/yak`) loads these declarations from this package,
and the store words and serving plugins below beside them.

An entity is a record identified by `entity.eid`; each of the names above is a
component, a named object on that record. `deploy.files` and `deploy.worker` are
strings supplied by the application. The vocabulary does not upload files,
configure DNS, send sign-in emails, charge customers, or enforce access policy.
Those operations are implemented by the application in `workers/yak`.

## Exports and example

The root import exports `platformDoc` and `reloadLevel`. `@yaks/platform/vocab`
also exports `docs: [platformDoc]` for plugin loaders. Load these declarations
into a graph and use its storage adapter to save the records:

```ts
import { platformDoc } from '@yaks/platform'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([platformDoc])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'team' }, space: { slug: 'team' } },
  {
    entity: { eid: 'notes' },
    app: { space: 'team', slug: 'notes', version: 1, access: 'private' },
  },
])
console.log(await g.read('.app.space=team'))
```

This example uses in-memory storage. Application slugs are unique within a
space; deployment versions are unique within an app. `plan` and `signin`
properties are stamped, so trusted application code supplies them rather than
ordinary client writes.

## What the platform and its clients share

The kernel (`workers/yak`) and `yak admin` (@yaks/admin) both import these, so
neither restates the other's names. Each is pure.

| export                     | holds                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@yaks/platform/names`     | `PLATFORM`, the platform's own host; `SLUG`, a space's or an app's slug; `PLATFORM_STORE`, the store the directory lives in; `LINK` and `INVITE`, the sign-in link's and an invitation's paths                                                                                                                                                                                                               |
| `@yaks/platform/cookie`    | `COOKIE`, the cookie a platform session rides in, and `cookieValue(header, name?)`, one cookie out of a `Cookie` header                                                                                                                                                                                                                                                                                      |
| `@yaks/platform/bots`      | which accounts and visitors are nobody's: `BOT`, the fleet's bot domain, `ADMIN` and `DEMO`, its two addresses that are not throwaways, `isTestAddress` and `isVerifiedBot`                                                                                                                                                                                                                                  |
| `@yaks/platform/budget`    | `SpaceBudget`, a space's monthly model and voice budget, and `budgetLines`, the lines a person reads it in                                                                                                                                                                                                                                                                                                   |
| `@yaks/platform/funnel`    | `Funnel`, yaks.app's own funnel as its admin door answers it, and `funnelLines`, the lines a person reads it in                                                                                                                                                                                                                                                                                              |
| `@yaks/platform/mover`     | what the store mover answers: `Swept`, a store a sweep asks; `Mark`, a rule's name; `Stamp`, `Standing` and `Rehearsal`, where a rule stands in a store and what a rehearsal found                                                                                                                                                                                                                           |
| `@yaks/platform/host`      | `Host`, a deployment's addresses read from its bindings; `apex`, `spaceHost` and `url`, its hostnames and pages; `hosted`, the platform's text said at them                                                                                                                                                                                                                                                  |
| `@yaks/platform/routes`    | where a request goes: `route(host, path)`, its space, app and path; `hostOf`, `foreign`, `platform`; `admitted`, space isolation by `Origin`, and `cors`; the dashboard's and sign-in's addresses                                                                                                                                                                                                            |
| `@yaks/platform/upstream`  | `Upstream`, where something shared came from when someone outside the platform wrote it; `hostable(licence)`, whether its licence allows a hosted copy; `linked`, a listing that is only a link to its source                                                                                                                                                                                                |
| `@yaks/platform/plans`     | what each plan gives a space: `Tier`, `paid` and `tierOf`; its ceilings and allowances (`FREE`, `PLUS`, `PRO`, `ceilings`, `allowance`); its model and voice `BUDGET` and `STARTER`; and what it costs (`PRICE`, `YEARLY`)                                                                                                                                                                                   |
| `@yaks/platform/meter`     | a space's month as its plan and meter read it (`Metered`, `meteredOf`, `Meter`, `spent`): its budget, credit and visitors' share (`budget`, `limitOf`, `credited`, `visiting`, `left`), and the patches a spend makes (`added`, `trended`)                                                                                                                                                                   |
| `@yaks/platform/standing`  | where a space stands against its plan, said aloud: its gauges (`gauges`, `level`, `gauged`, `standingOf`) and every refusal there (`atCeiling`, `unaffordable`, `refusedSpend`, `atStored`, `tooManySpaces`)                                                                                                                                                                                                 |
| `@yaks/platform/files`     | which of an app's files answers a request: `resolve(path, load, notFound)` (a folder's index.html, `/about` as about.html, Cloudflare's `assets.not_found_handling`, `nearest`), `rootOf` and `servedAt` for the folder `assets.directory` serves, `inside` and `seedy`, the app's inside no address answers, `decoded`, a request path read safely, and `serving`, what serving honors of a wrangler config |
| `@yaks/platform/page-wire` | the `/api/*` wire an app's pages speak and its translation to the store's: `lineOf`, the line a page's `query` door was asked; `lined`, a page's filter line in the store's grammar; `batched`, a page's batch either way it was sent; `receipt`, the batch as applied in the wire it was sent in; `minted`, a batch's aliases; `resend`, a write's resend identity                                          |

## An app store's plugins

What yaks.app's stores compose beyond the package words, so any host can serve
an app's graph the same way. Each export is pure: a vocabulary, a graph plugin,
or a handler over a graph and the host functions it is given.

| export                                                                                                                             | holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/platform/app-vocab`, `directory-vocab`, `trash-vocab`, `meter-vocab`, `models-vocab`, `attribution-vocab`, `refusals-vocab` | the `docs` of the `yak/app`, `yak/directory`, `yak/trash`, `yak/meter`, `yak/models`, `yak/attribution` and `yak/refusals` plugins' vocab facets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@yaks/platform/config`                                                                                                            | `appConfig`, what an app's store composes, and `appVersionsConfig` with `versions`, the journal a store that keeps versions adds; `THROUGH` and the parts every platform store's config shares (`spine`, `provenance`, `machine`, `behind`, …)                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@yaks/platform/facets`                                                                                                            | `facets`, where each `yak/*` plugin a store config names keeps its facets in this package, the one table every host resolves those names through; `beside(own)`, that table with a host's own facets added; and `resolved(load)`, a host's loader resolving them through it                                                                                                                                                                                                                                                                                                                                                                    |
| `@yaks/platform/manifest`                                                                                                          | `manifest(source, file)`, an app's `vocab.json` (or `vocab.yml`, `VOCABS`) read as one document by the rules every host loads it by, refused in a sentence where it is wrong (`EXAMPLE`, `KINDS`, `joinErrors`, `kindErrors`); `OPENS`, the words that open a spend to an app's visitors; `owns(doc)` and `owned(vocab, file)`, its permission and owner names refused where they do not resolve in the words its store composes, which a deploy and `yak release serve` both ask before a store opens; and `appDocs(doc)`, what an app's store speaks beside its plugins' words                                                               |
| `@yaks/platform/notices-vocab`                                                                                                     | `noticesDoc`, an app's notice subscriptions and letters, and `noticeEffects`, the effects an app that keeps them runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@yaks/platform/schema`                                                                                                            | the scalar and ownership property shapes those words are written with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@yaks/platform/lent`, `admit-graph`, `describe-graph`, `embed-graph`, `weigh-graph`, `log-graph`, `lexicon-graph`, `rouse-graph`  | `Lent`, what a host lends an app store's own graph facets (its name, `weigh`, `rouse`, `embed`, `tell`, the write log, the app's `manifest`, the `graph` its own effects write through, and in the store that keeps the platform's schedules the `job` a rule's row asks for); `maintenance(run)`, a handler that is the store's upkeep and not anyone's use; `bare(name, manifest)`, what a host that keeps no ledger beside the store lends; `lends(store)`, the options that give the store's own plugins their store; and the `yak/admit`, `yak/describe`, `yak/embed`, `yak/weigh`, `yak/log`, `yak/lexicon` and `yak/rouse` graph facets |
| `@yaks/platform/lower-graph`                                                                                                       | the `yak/lower` graph facet: named references lowered to the eid the vocabulary stores                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@yaks/platform/lenses`, `lenses-graph`                                                                                            | an app's lenses as pure functions of its declarations (`lensDocAt`, `ownSpeaks`, `latestSpeaks`, `retainedLenses`, `contractedLenses`) and the hosted session lens (`sessionLens`, `sessionBridge`); and the `yak/lenses` graph facet, which reads every row through them                                                                                                                                                                                                                                                                                                                                                                      |
| `@yaks/platform/trash-graph`, `kills-graph`, `wrap-graph`, `remake-graph`, `git-graph`                                             | the `yak/trash` graph facet (a fresh trash mark stamped) and the directory's sweeps: each fired wake row asks the host for the job its kind names (`Lent.job`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@yaks/platform/files-routes`                                                                                                      | the `yak/files` routes facet: the release's files at its own addresses by `@yaks/platform/files`' rules, read through the `file` its host lends (`Lent.file`); a host that lends none gets no route                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@yaks/platform/client-routes`                                                                                                     | the `yak/client` routes facet: the store client at `./api/client.js`, bundled where it is served, and its `query`, `apply` and `vocab.json` doors in the page's wire (`page-wire`), each asked again of the store's own; yaks.app serves the client from its built assets and answers the doors itself                                                                                                                                                                                                                                                                                                                                         |
| `@yaks/platform/client`                                                                                                            | the store client an app's pages import (`query`, `apply`, `subscribe`, `me`, `upload`), one browser module bundled with its parts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@yaks/platform/qr`                                                                                                                | `qr(text, label)`: a QR code as inline SVG, which the client re-exports for app pages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `@yaks/platform/escape`                                                                                                            | `esc(s)`: text escaped for HTML and quoted attributes, on server and browser                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@yaks/platform/meter-graph`                                                                                                       | the `yak/meter` graph facet: a spend added to its space's month in the write's own transaction, refused where it is held past what is left, and the hourly meter and each held number's month asked of the host (`Lent.job`)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@yaks/platform/documents`, `document-graph`, `app-graph`                                                                          | which files a store reads as documents (`DOCUMENTS`, `supported`, `isPdf`, `plain`); `documentPages`, which keeps a document's pages with it; and the `yak/app` graph facet that adds it where a store's words have pages                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@yaks/platform/app-authority`                                                                                                     | `Vouch` and `vouchOf`, who the kernel vouches a request for; `authenticating`; `FLOORS` and `floorsOf`, the level each write needs; `appGuard`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@yaks/platform/app-writes`                                                                                                        | `lowering` and `vouching`, the graph plugins a write passes through; `grantEid` and `staleGrant`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@yaks/platform/app-read`                                                                                                          | `appRead`, an app's query door: listings, aggregates and ranked answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `@yaks/platform/app-subs`                                                                                                          | `kinded` and `naming`, a page's subscriptions in the same rows as its query door                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@yaks/platform/app-storage`                                                                                                       | `weighing`, a committed write's measured size, and `eraseStore`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `@yaks/platform/listing`                                                                                                           | what a listing carries: `STAMPS`, `KERNEL`, `PLATFORM`, `asking`, `listed`, `named`, `listing`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@yaks/platform/app-commands`                                                                                                      | an app's commands as its release declares them: `commandsOf`, its manifest's own (`appTools`, the old grammar a kept release still writes translated, and `readTools` for a store's kept ones) with the two each kind is worth (`withKinds`, `kindsOf`, `generated`), and `index`, each kind in a line                                                                                                                                                                                                                                                                                                                                         |
| `@yaks/platform/app-command`                                                                                                       | running one for a caller through the acts its host lends (`Acts`): `commandReply`, its floor checked and its answer said; `listed`, the commands a caller can discover; `workerReply`, the app worker's answer as a command's                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `@yaks/platform/instrument`                                                                                                        | `instrumentEid` and `instrumentActor`, a credential's one graph identity; `agentEid` and `agentRow`, an agent writing for a person                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Serving a release on this machine

`yak release serve <dir>` (the `./cli` facet) opens a release directory as the
store yaks.app keeps for its app and serves it through @yaks/api: the
directory's `vocab.json` (or `vocab.yml`) is the graph's own words, read by
`manifest`, over `appConfig`'s plugins with the `yak/*` ones resolved through
`facets` and lent the store by `bare`. The commands its manifest declares, and
the two each of its kinds is worth (`app-commands` `commandsOf`), are the
store's own tools, called through its runner like any host's. Its commands run
through @yaks/tools and its effects through @yaks/effects, and its own files
answer at their addresses through the `yak/files` routes facet, read from the
directory as it stands, by the rules yaks.app serves them by
(`@yaks/platform/files`): its inside (vocab.json, worker.js, seeds) and `.yak/`
answer nothing. Its pages import their store client (`@yaks/platform/client`)
from `./api/client.js`, which the `yak/client` routes facet bundles as the host
warms. The same facet answers the client's `query`, `apply` and `vocab.json` in
the page's wire (`@yaks/platform/page-wire`), asking each of the store's own
door, and the store's doors answer beside it under `/api` as well as at the root
(@yaks/api `under`), so `ws` and `who` are the store's own and a page's `query`,
`apply` and `subscribe` reach this store. The store is kept in `.yak/store.db`
in the directory unless `--db` names another file or `:memory:`; `--port` and
`--hostname` say where it listens.

`@yaks/platform/released` is the same in code: `release(dir)`, the directory's
app name and manifest; `releaseConfig`, what its store composes; `reader(dir)`,
the directory's files as `Lent.file` reads them; `opened(dir, roles)`, its store
composed by @yaks/cli's host; and `serve`. Of the effects yak/app declares, a
release served here runs the ones `@yaks/platform/app-effects` holds (its
builders kept with their provenance); the rest (letters, models, the trash
sweep, attribution, an upload's bytes) are the Worker's Cloudflare work, which
its own facets run beside these, and here they owe no run. A command whose
template calls the app's own worker (`worker`) answers that the worker is
unavailable, since nothing here runs `worker.js`, and a command's `floor` is not
asked: this machine's store has no members. Compiled TypeScript page scripts are
yaks.app's, and are not served here yet.

## Compatibility

Deno and Node — a JSON document, with no runtime calls.

## Release levels

`reloadLevel(was, next, crossed)` compares two releases (`files` and `vocab`)
and intervening deploy marks. Identical files produce no notice, even for a
rollback. Otherwise a dropped or retyped definition/property, or any crossed
`reload: 'required'` mark, requires reload; all other changes are optional.
`deploy.reload` can raise the reload level, never lower it. `source` keeps the
source release of an installed copy. Neither this rule nor a required notice
reloads pages automatically.

## Live versions

`app{version, source, script, declaration}` selects a kept deploy's serving
bytes. `deploy{app, version, files, worker, script, source, reload}` is the
immutable release record. Rollback moves the live pointer, creates no deploy,
and leaves existing deploy rows unchanged. A subsequent deploy allocates above
the highest kept version, not above the live pointer.

`switched{app, from, to, source, at, by, via}` records every pointer move, with
references to the kept deploys and server-stamped provenance. `from` is absent
on the first deploy; `via` is null when no session can be identified. Its source
keeps the serving bytes of a legacy source-less deploy reachable without
rewriting that deploy. Reload comparison works in either direction.
