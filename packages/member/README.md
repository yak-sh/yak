# @yaks/member

**Who belongs, and what they may touch** — the membership component domain for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/member
# or: npx jsr add @yaks/member
```

## The book club

A book club keeps three things in one place: a reading list anyone may see, a
potluck sign-up sheet anyone may add a line to, and the committee's private
notes. Three questions come up at once, and this package is the three answers.

**Who belongs?** A seat on the club's roster.

```
{ entity: { eid: '…' }, member: { space: club, person: dana, role: 'owner' } }
```

`owner` runs the club — billing, evictions, and implicit ownership of everything
in it. `member` belongs, and reaches what they are granted.

**What may they touch?** A grant, on one thing.

```
{ entity: { eid: '…' }, grant: { app: list, person: raj, access: 'editor' } }
```

`owner` shares and deletes it, `editor` writes it, `viewer` reads it.

**And everyone else?** What the thing itself says.

```
{ entity: { eid: list }, access: { mode: 'public' } }
```

- `public` — anyone with the link reads it. (An app that never said is this.)
- `open` — anyone with the link reads it **and writes it**, signed in or not.
- `private` — only the granted see it at all.

## Belonging is not access

A seat gives nothing on its own. A member with no grant reaches the potluck
sheet exactly as far as a stranger with the link does — which is what makes a
roster safe to be generous with, and why eviction is one row: take the seat away
and every implicit ownership goes with it.

The ladder, in the order it is walked:

| the asker                  | what they hold            |
| -------------------------- | ------------------------- |
| nobody at all              | nothing; the mode decides |
| the space's **owner**      | `owner`, on everything    |
| someone a **grant** names  | what the grant says       |
| a member with **no grant** | nothing; the mode decides |

## Two rules, said once

```
read    the mode is not `private`, OR the asker holds any level
write   the mode is `open`,        OR the asker holds owner or editor
```

A `viewer` never writes, under any mode. Both rules live in one file, so the
door and `apply()` cannot drift apart.

## Two places they are enforced

A **write** is refused inside `apply()`. The plugin registers a `precondition`
hook, so the check reads through the batch's own transaction before a row moves
and a refused batch rolls back whole:

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
// Denied: mo may not write list — editor is the least that may
```

The actor is whatever `$actor` the batch carries, which a door has already
replaced with the identity it authenticated
([@yaks/api](https://jsr.io/@yaks/api) `signed`). A batch with **no** actor is
nobody — permitted on an `open` thing, refused everywhere else, which is exactly
what an anonymous visitor is.

A **read** never reaches `apply()`, so the door asks first:

```ts
import { policy } from '@yaks/member'

let may = policy(storage, { space: club })
may.canRead(dana, notes) // true — she owns the club
may.canRead(kim, notes) // false — private, and she holds nothing
```

Every answer is synchronous over a synchronous storage: not one of these returns
a promise over a Map or an embedded database.

## The roster governs itself

Only an **owner** may write a `member`, a `grant` or an `access`. An editor
writes the data and does not hand out keys. That matters most on an `open`
thing, where anyone may write: without the rule, a visitor invited to sign the
guest book could rewrite the roster and lock the owner out of their own club.

Which leaves the bootstrap: a graph with a guard on it and an empty roster
admits nobody, because there is no owner yet to write the row that makes one. So
seed the first owner before the guard exists:

```ts
let g = graph({ storage, vocab })
g.apply([{
  entity: { eid: 'seat1' },
  member: { space: club, person: dana, role: 'owner' },
}])
g.use(members({ app: list, space: club }))
```

## Share links

A grant may name a `token` instead of a person:

```
{ entity: { eid: 'share' }, grant: { app: notes, token: 'x7v2…', access: 'viewer' } }
```

Whoever opens that link acts **as** the grant — the door signs their writes with
the grant's own entity — so everything above works unchanged. No account, no
seat, one revocable row, good for that one thing.

## Invitations are somebody else's job

Adding someone to a roster usually means writing to them. That is a
`created('member')` handler on [@yaks/effects](https://jsr.io/@yaks/effects) —
post-commit, so the seat is real before the letter goes, and isolated, so a mail
server that is down does not refuse the invitation:

```ts
fx.created('member', (e, tx) => invite(e.comp?.person, e.comp?.space))
```

This package ships no such handler. `@yaks/mail` fills the slot.

## The surface

| export                                     | is                                              |
| ------------------------------------------ | ----------------------------------------------- |
| `memberDoc`                                | the three components, to load beside your own   |
| `MEMBER`, `GRANT`, `ACCESS`                | their names; `GOVERNED` is the three together   |
| `Role`, `Level`, `Mode`                    | the words, and `ROLES`/`LEVELS`/`MODES`         |
| `role`, `level`, `mode`                    | a stored value read, with its default           |
| `writes(level)`                            | may someone holding this level write?           |
| `members(guard)`                           | the @yaks/graph plugin — components and hook    |
| `guarding(guard)`, `actorOf`, `governs`    | the hook, and the two facts it reads            |
| `policy(storage, where)`                   | `modeOf`, `levelOf`, `canRead`, `canWrite`      |
| `modeOn`, `levelOn`, `readsOn`, `writesOn` | the same, through a transaction                 |
| `Denied`                                   | the refusal: who, which app, what would suffice |

## What is deliberately not here

**Authentication.** Establishing who someone _is_ belongs to the door; this
decides what that identity may do.

**Per-grant filters.** A grant good for only part of the data is not a level,
and one level per thing is what fits in a person's head.

**A fourth tier.** The three levels mirror what the platform this was drawn from
already distinguishes. Adding one is a design decision, not a default.

## Where it sits

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape an application's own plugin has — like
[@yaks/edge](https://jsr.io/@yaks/edge), it ships components and a hook and
nothing privileged. Its refusal reaches a client through
[@yaks/api](https://jsr.io/@yaks/api)'s refusal shape, which answers a `Denied`
with a 403.

## Compatibility

Pure TypeScript, no platform API — reads go through @yaks/graph's `Storage`
seam. Runs on **Deno**, **Node**, and in the **browser**.
