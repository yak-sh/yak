# @yaks/member

Access control for a [@yaks/graph](../graph). Three components record who
belongs to a space and what each person may do, and two checks enforce them —
one inside `apply()` for writes, one the HTTP layer calls before it answers a
read.

## Install

```sh
deno add jsr:@yaks/member
# or: npx jsr add @yaks/member
```

## Terms

A **principal** is the entity doing something: a person, or — for a share link —
the grant itself. An **app** is any entity that access is decided about; this
package never declares what an app is, only who may reach one. A **space** is
the entity a roster belongs to, and whose owners own the apps in it. Both are
plain entities in your own vocabulary.

The examples use a book club: a `space` named `club`, a reading `list` and a
`notes` page as its two apps, and four people. It is the same fixture the tests
use (`harness.ts`).

## The three components

**`member{space, person, role}`** — one row per person per space, the roster:

```
{ entity: { eid: 'seat1' }, member: { space: club, person: dana, role: 'owner' } }
```

`role` is `owner` or `member`. An `owner` runs the space — billing, removals —
and holds `owner` permission on every app in it. A `member` belongs to the space
and holds nothing beyond what a grant gives them.

**`grant{app, person, access}`** — one principal's permission on one app:

```
{ entity: { eid: 'g1' }, grant: { app: list, person: raj, access: 'editor' } }
```

`access` is `owner` (shares and deletes it), `editor` (writes it) or `viewer`
(reads it).

**`access{mode}`** — what the app allows everyone who has no grant on it:

```
{ entity: { eid: list }, access: { mode: 'public' } }
```

- `public` — anyone with the link reads it; only the granted write it. An app
  with no `access` component is `public`.
- `open` — anyone with the link reads **and writes** it, signed in or not.
- `private` — only principals holding a permission see it at all.

## Membership is not permission

Being on the roster grants nothing by itself. A member with no grant reaches an
app exactly as far as a stranger with the link does. That is what makes a roster
safe to be generous with, and it is why removing someone is one row: delete the
membership and every permission implied by it goes too.

Permission is resolved in this order:

| principal                     | level it holds                     |
| ----------------------------- | ---------------------------------- |
| nobody (an anonymous request) | none; the app's mode decides       |
| the space's **owner**         | `owner`, on every app in the space |
| a principal a **grant** names | the grant's `access`               |
| a member with **no grant**    | none; the app's mode decides       |

The first and last rows land in the same place, which is the point. The space
owner's `owner` level is never stored per app — storing it would be a row to
forget to write.

## The two checks

```
read    the mode is not `private`, OR the principal holds any level
write   the mode is `open`,        OR the principal holds owner or editor
```

A `viewer` never writes, under any mode. Both are pure functions in `words.ts`
(`reads(mode, level)` and `edits(mode, level)`), taking a mode and a level and
nothing else, so the check inside `apply()` and the check at the HTTP layer
cannot drift apart. A service that already knows both — one that authenticated
the caller at its edge and keeps modes in a directory — calls them directly,
with no storage involved.

## Where each check runs

A **write** is refused inside `apply()`. `members()` registers a `precondition`
hook, which runs inside the transaction before any row has moved, so the check
reads the transaction's own view and a refused list of changes rolls back whole:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { memberDoc, members } from '@yaks/member'

let vocab = loadVocab([memberDoc, club])
let g = graph({
  storage,
  vocab,
  plugins: [members({ app: list, space: club })],
})

g.apply([{
  entity: { eid: 'p1' },
  pick: { title: 'Piranesi' },
  $actor: { by: mo },
}])
// throws Denied: mo may not write list — editor is the least that may
```

The principal is whatever `$actor` the changes carry. An HTTP layer replaces
that field with the identity it authenticated before calling `apply()` — see
[@yaks/api](https://jsr.io/@yaks/api)'s `signed`. Changes with no `$actor` act
as nobody: allowed on an `open` app, refused everywhere else, which is what an
anonymous visitor should get.

A **read** never reaches `apply()`, so the HTTP layer checks first:

```ts
import { policy } from '@yaks/member'

let may = policy(storage, { space: club })
may.canRead(dana, notes) // true — she owns the club
may.canRead(kim, notes) // false — private, and she holds nothing
```

Over a synchronous storage — a Map, an embedded database — every one of these
returns a value rather than a promise.

## Only an owner edits the access rows

The `member`, `grant` and `access` components are governed: a transaction that
touches any of them is refused unless the principal holds `owner` on the app. An
editor writes the app's data and does not hand out permissions. That matters
most on an `open` app, where the first check admits everybody: without this
rule, a visitor invited to sign the guest book could rewrite the roster and lock
the owner out.

Which leaves the bootstrap. A graph with the guard installed and an empty roster
admits nobody, because there is no owner yet to write the row that makes one. So
write the first owner before installing the guard:

```ts
let g = graph({ storage, vocab })
g.apply([{
  entity: { eid: 'seat1' },
  member: { space: club, person: dana, role: 'owner' },
}])
g.use(members({ app: list, space: club }))
```

From there the roster maintains itself: an owner adds the next one.

## Share links

A grant may name a `token` instead of a person:

```
{ entity: { eid: 'share' }, grant: { app: notes, token: 'x7v2…', access: 'viewer' } }
```

Whoever opens that link acts **as** the grant: the HTTP layer signs their
changes with the grant's own entity id, and everything above works unchanged,
because permission resolution checks the principal's own `grant` component
before it looks for grants about the principal. No account, no roster row, one
revocable row, scoped to one app.

## Invitations belong to another package

Adding someone to a roster usually means sending them a message. That is a
`created('member')` handler on [@yaks/effects](https://jsr.io/@yaks/effects) —
it runs after the commit, so the row exists before the message goes out, and it
is isolated, so a mail server that is down does not refuse the write:

```ts
fx.created('member', (e, tx) => invite(e.comp?.person, e.comp?.space))
```

This package ships no such handler. `@yaks/mail` provides one.

## Exports

| export                                     | what it is                                        |
| ------------------------------------------ | ------------------------------------------------- |
| `memberDoc`                                | the three components, to load beside your own     |
| `MEMBER`, `GRANT`, `ACCESS`                | their component names; `GOVERNED` is the three    |
| `Role`, `Level`, `Mode`                    | the value types, and `ROLES`/`LEVELS`/`MODES`     |
| `role`, `level`, `mode`                    | read a stored value, falling back to its default  |
| `writes(level)`                            | may a principal holding this level write?         |
| `members(guard)`                           | the @yaks/graph plugin — components and hook      |
| `guarding(guard)`, `actorOf`, `governs`    | the hook, and the two facts it reads              |
| `policy(storage, where)`                   | `modeOf`, `levelOf`, `canRead`, `canWrite`        |
| `modeOn`, `levelOn`, `readsOn`, `writesOn` | the same checks, against a transaction            |
| `Denied`                                   | the refusal: who, which app, which level would do |

## What is deliberately not here

**Authentication.** Establishing who someone _is_ belongs to the HTTP layer;
this package decides what an established identity may do.

**Per-grant filters.** A grant good for only part of an app's data is not a
level, and one level per app is what fits in a person's head.

**A fourth level.** Three levels mirror what the platform this was drawn from
already distinguishes. Adding one is a design decision, not a default.

## Integration

This is an ordinary [@yaks/graph](https://jsr.io/@yaks/graph) plugin, the same
shape an application's own plugin has — like
[@yaks/edge](https://jsr.io/@yaks/edge) it contributes components and a hook and
nothing privileged. A `Denied` reaches a client through
[@yaks/api](https://jsr.io/@yaks/api)'s error response, which answers it with a
403.

## Compatibility

Pure TypeScript with no platform API: reads go through @yaks/graph's `Storage`
interface. Runs on **Deno**, **Node**, and in the **browser**.
