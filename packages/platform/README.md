# @yaks/platform

Defines graph components for a hosting platform's applications, deployments,
customer spaces, billing usage, sign-ins, and error reports. It also compares
releases and holds the names and rules the platform and its clients share,
without storage or runtime calls; it is not a deployment server or billing
implementation.

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

| export                    | holds                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/platform/names`    | `PLATFORM`, the platform's own host; `SLUG`, a space's or an app's slug; `PLATFORM_STORE`, the store the directory lives in; `LINK` and `INVITE`, the sign-in link's and an invitation's paths                |
| `@yaks/platform/cookie`   | `COOKIE`, the cookie a platform session rides in, and `cookieValue(header, name?)`, one cookie out of a `Cookie` header                                                                                       |
| `@yaks/platform/bots`     | which accounts and visitors are nobody's: `BOT`, the fleet's bot domain, `ADMIN` and `DEMO`, its two addresses that are not throwaways, `isTestAddress` and `isVerifiedBot`                                   |
| `@yaks/platform/budget`   | `SpaceBudget`, a space's monthly model and voice budget, and `budgetLines`, the lines a person reads it in                                                                                                    |
| `@yaks/platform/funnel`   | `Funnel`, yaks.app's own funnel as its admin door answers it, and `funnelLines`, the lines a person reads it in                                                                                               |
| `@yaks/platform/mover`    | what the store mover answers: `Swept`, a store a sweep asks; `Mark`, a rule's name; `Stamp`, `Standing` and `Rehearsal`, where a rule stands in a store and what a rehearsal found                            |
| `@yaks/platform/host`     | `Host`, a deployment's addresses read from its bindings; `apex`, `spaceHost` and `url`, its hostnames and pages; `hosted`, the platform's text said at them                                                   |
| `@yaks/platform/routes`   | where a request goes: `route(host, path)`, its space, app and path; `hostOf`, `foreign`, `platform`; `admitted`, space isolation by `Origin`, and `cors`; the dashboard's and sign-in's addresses             |
| `@yaks/platform/upstream` | `Upstream`, where something shared came from when someone outside the platform wrote it; `hostable(licence)`, whether its licence allows a hosted copy; `linked`, a listing that is only a link to its source |

## An app store's plugins

What yaks.app's stores compose beyond the package words, so any host can serve
an app's graph the same way. Each export is pure: a vocabulary, a graph plugin,
or a handler over a graph and the host functions it is given.

| export                                                                                                                             | holds                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/platform/app-vocab`, `directory-vocab`, `trash-vocab`, `meter-vocab`, `models-vocab`, `attribution-vocab`, `refusals-vocab` | the `docs` of the `yak/app`, `yak/directory`, `yak/trash`, `yak/meter`, `yak/models`, `yak/attribution` and `yak/refusals` plugins' vocab facets                                                                                                                                                                                                         |
| `@yaks/platform/config`                                                                                                            | `appConfig`, what an app's store composes, and `appVersionsConfig` with `versions`, the journal a store that keeps versions adds; `THROUGH` and the parts every platform store's config shares (`spine`, `provenance`, `machine`, `behind`, …)                                                                                                           |
| `@yaks/platform/notices-vocab`                                                                                                     | `noticesDoc`, an app's notice subscriptions and letters, and `noticeEffects`, the effects an app that keeps them runs                                                                                                                                                                                                                                    |
| `@yaks/platform/schema`                                                                                                            | the scalar and ownership property shapes those words are written with                                                                                                                                                                                                                                                                                    |
| `@yaks/platform/lent`, `admit-graph`, `describe-graph`, `embed-graph`, `weigh-graph`, `log-graph`, `lexicon-graph`, `rouse-graph`  | `Lent`, what a host lends an app store's own graph facets (its name, `weigh`, `rouse`, `embed`, `tell`, the write log, the app's `manifest`, and in the store that keeps the platform's schedules the `job` a rule's row asks for); and the `yak/admit`, `yak/describe`, `yak/embed`, `yak/weigh`, `yak/log`, `yak/lexicon` and `yak/rouse` graph facets |
| `@yaks/platform/lower-graph`                                                                                                       | the `yak/lower` graph facet: named references lowered to the eid the vocabulary stores                                                                                                                                                                                                                                                                   |
| `@yaks/platform/lenses`, `lenses-graph`                                                                                            | an app's lenses as pure functions of its declarations (`lensDocAt`, `ownSpeaks`, `latestSpeaks`, `retainedLenses`, `contractedLenses`) and the hosted session lens (`sessionLens`, `sessionBridge`); and the `yak/lenses` graph facet, which reads every row through them                                                                                |
| `@yaks/platform/trash-graph`, `kills-graph`, `wrap-graph`, `remake-graph`, `git-graph`                                             | the `yak/trash` graph facet (a fresh trash mark stamped) and the directory's sweeps: each fired wake row asks the host for the job its kind names (`Lent.job`)                                                                                                                                                                                           |
| `@yaks/platform/documents`, `document-graph`, `app-graph`                                                                          | which files a store reads as documents (`DOCUMENTS`, `supported`, `isPdf`, `plain`); `documentPages`, which keeps a document's pages with it; and the `yak/app` graph facet that adds it where a store's words have pages                                                                                                                                |
| `@yaks/platform/app-authority`                                                                                                     | `Vouch` and `vouchOf`, who the kernel vouches a request for; `authenticating`; `FLOORS` and `floorsOf`, the level each write needs; `appGuard`                                                                                                                                                                                                           |
| `@yaks/platform/app-writes`                                                                                                        | `lowering` and `vouching`, the graph plugins a write passes through; `grantEid` and `staleGrant`                                                                                                                                                                                                                                                         |
| `@yaks/platform/app-read`                                                                                                          | `appRead`, an app's query door: listings, aggregates and ranked answers                                                                                                                                                                                                                                                                                  |
| `@yaks/platform/app-subs`                                                                                                          | `kinded` and `naming`, a page's subscriptions in the same rows as its query door                                                                                                                                                                                                                                                                         |
| `@yaks/platform/app-storage`                                                                                                       | `weighing`, a committed write's measured size, and `eraseStore`                                                                                                                                                                                                                                                                                          |
| `@yaks/platform/listing`                                                                                                           | what a listing carries: `STAMPS`, `KERNEL`, `PLATFORM`, `asking`, `listed`, `named`, `listing`                                                                                                                                                                                                                                                           |
| `@yaks/platform/instrument`                                                                                                        | `instrumentEid` and `instrumentActor`, a credential's one graph identity; `agentEid` and `agentRow`, an agent writing for a person                                                                                                                                                                                                                       |

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
