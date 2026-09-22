# @yaks/member

Access control for [@yaks/graph](../graph). The package stores space
memberships, permission grants and access modes as graph components. It checks
writes inside `apply()` and provides a read check for an HTTP handler or other
caller to run before returning data.

It does not authenticate callers, open storage or automatically protect reads.

## Install

```sh
deno add jsr:@yaks/member
# or: npx jsr add @yaks/member
```

The complete example below also uses `@yaks/graph`, `@yaks/vocab`, `@yaks/ram`
and `@yaks/doc`.

## Terms

A **principal** is the entity making a request: usually a person, or a grant
entity representing a share link. An **app** is the entity whose access rules
apply to the graph. A **space** groups memberships; its owners receive owner
permission when a policy or guard is configured with that space's id.

The application supplies app, space and principal entity ids. This package does
not declare their components or infer an app's space from its contents.

## The three components

These components are stored by the graph's storage adapter, alongside the
application's other data:

| Component                           | Purpose                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `member{space, person, role}`       | Associates a person with a space. `role` defaults to `member`; `owner` supplies owner permission to policies configured for that space.                         |
| `grant{app, person, token, access}` | Gives a principal permission on an app. `access` defaults to `viewer`, with `editor` and `owner` also supported. A share link uses `token` instead of `person`. |
| `access{mode}`                      | Sets an app's access mode. Missing or unset mode defaults to `public`.                                                                                          |

Memberships and grants are separate entities. The `access` component is stored
on the app entity. References from `member` and `grant` use `death: cascade`, so
deleting a referenced person, space or app removes the dependent entities. Use
qualified query names such as `.grant.person=dana` and `.grant.access=editor`
for columns whose short names are disabled.

The modes determine access:

| Mode      | Read                                  | Write ordinary data                             |
| --------- | ------------------------------------- | ----------------------------------------------- |
| `public`  | Anyone                                | Owner or editor                                 |
| `open`    | Anyone                                | Anyone, including anonymous callers and viewers |
| `private` | Any principal with a permission level | Owner or editor                                 |

## Membership is not permission

An ordinary membership supplies no permission. A grant can authorize a person
who has no membership at all. Removing a membership removes any owner permission
derived from that membership, but **does not revoke explicit grants**. Remove
the grants separately when revoking those permissions.

Permission resolution checks these cases in order:

1. An anonymous principal has no permission level.
2. If the principal entity itself carries a grant for this app, use that grant's
   access level. This supports share links.
3. If the principal is an owner in the configured space, use `owner`.
4. Otherwise, use the first matching grant naming that person and app, or no
   level if none exists.

Space-owner permission is computed from membership, without storing a grant for
every app. Omitting `space` from the policy or guard disables this source of
permission. The package does not combine multiple grants by taking their highest
level; avoid conflicting duplicate grants for a person and app.

## The two checks

`reads(mode, level)` allows reads when the mode is not `private` or the
principal has any level. `edits(mode, level)` allows writes when the mode is
`open` or the level is `owner` or `editor`.

These exported functions require no storage. A viewer can write an `open` app;
on `public` and `private` apps a viewer can only read. `writes(level)` checks
the level alone and returns true for `owner` and `editor`.

## Where each check runs

This complete example uses in-memory storage, creates an initial owner, then
installs the write guard:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { memberDoc, members, policy } from '@yaks/member'

let vocab = loadVocab([memberDoc, docDoc])
let storage = ram(vocab)
let g = graph({ storage, vocab })

await g.apply([
  { entity: { eid: 'club' }, doc: { title: 'Book club' } },
  { entity: { eid: 'dana' }, doc: { title: 'Dana' } },
  {
    entity: { eid: 'notes' },
    doc: { title: 'Club notes' },
    access: { mode: 'private' },
  },
  {
    entity: { eid: 'membership' },
    member: { space: 'club', person: 'dana', role: 'owner' },
  },
])
g.use(members({ app: 'notes', space: 'club' }))

await g.apply([{
  entity: { eid: 'notes' },
  doc: { body: 'Next meeting: Thursday' },
  $actor: { by: 'dana' },
}])

let may = policy(storage, { space: 'club' })
console.log(await may.canRead('dana', 'notes')) // true
console.log(await may.canRead(null, 'notes')) // false
```

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction. The guard selects the first nonempty
`$actor.by` in the batch as its principal, and uses the configured app's access
rules for the entire batch. It is not a per-entity filter for a graph containing
several independently protected apps.

`members()` registers a `precondition` hook. It reads permissions inside the
transaction before applying changes; throwing `Denied` rolls back that
transaction. Changes without an actor are anonymous, so ordinary writes are
allowed only when the app is `open`.

The code receiving a request must authenticate the caller and replace any
client-supplied actor before applying changes. [@yaks/api](../api) uses
`signed()` for that replacement. This package trusts the actor it receives.

Reads do not pass through `apply()`. Call `policy(storage, { space }).canRead`
before returning results. `policy()` also exposes `modeOf`, `levelOf` and
`canWrite`. These methods return values for synchronous storage and promises for
asynchronous storage; `await` works with either.

## Only an owner edits the access rows

Changes that write or remove `member`, `grant` or `access` components require
owner permission on the configured app. An editor can change ordinary data but
cannot write these access-control components. This additional check also runs
for an `open` app.

Create the first owner membership before installing `members()`, as in the
example. With the guard installed, writing the first owner membership requires
an owner that does not yet exist. Thereafter an authorized owner can maintain
memberships and grants through the guarded graph.

## Share links

A grant can identify a link token instead of a person:

```json
{
  "entity": { "eid": "share" },
  "grant": { "app": "notes", "token": "a-secret-token", "access": "viewer" }
}
```

The authentication layer validates the token and identifies the caller as
`share`, the grant entity's id. Permission lookup then reads that entity's own
grant. Deleting the grant revokes its permission. Its permission applies only to
the named app; that app's mode still applies, including unrestricted ordinary
writes when the mode is `open`.

This package does not generate tokens, validate incoming tokens, or implement an
HTTP route for opening a link.

## Invitations belong to another package

[@yaks/mail](../mail) supplies invitation handling through
[@yaks/effects](../effects). A `created('member')` handler runs after commit, so
a delivery failure does not roll back the membership write. For an application
with an effects registry named `fx` and its own `invite` function:

```ts
fx.created('member', (event) => invite(event.comp?.person, event.comp?.space))
```

This package registers no invitation handler.

## Exports

| Import path          | Exports                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `@yaks/member`       | Component definitions, access helpers, policy, write guard, plugin and error listed below. |
| `@yaks/member/vocab` | `memberDoc` and `docs`, the array of vocabulary documents.                                 |

The main export includes:

| Exports                                                   | Purpose                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `memberDoc`                                               | Vocabulary document containing the three components.                           |
| `MEMBER`, `GRANT`, `ACCESS`, `GOVERNED`                   | Component names and the list requiring owner permission.                       |
| `Role`, `Level`, `Mode`; `ROLES`, `LEVELS`, `MODES`       | Value types and their supported values.                                        |
| `role`, `level`, `mode`                                   | Read a value with its default: member, viewer or public.                       |
| `reads`, `edits`, `writes`                                | Pure permission checks.                                                        |
| `members(guard)`                                          | Graph plugin with the vocabulary, permission-read requirements and write hook. |
| `guarding(guard)`, `wanting(guard)`, `actorOf`, `governs` | Write hook and supporting helpers.                                             |
| `policy(storage, where)`                                  | Read and write checks bound to storage.                                        |
| `modeOn`, `levelOn`, `readsOn`, `writesOn`                | Checks using an existing graph transaction.                                    |
| `Guard`, `Viewer`, `Where`, `Policy`                      | Configuration and policy types.                                                |
| `Denied`                                                  | Error with `actor`, `app`, `need` and `act` fields.                            |

## What is deliberately not here

Authentication belongs to the caller. Permissions apply to an app as a whole;
this package supplies no per-grant query filters. It supports exactly the
`viewer`, `editor` and `owner` levels.

## Integration

`members()` is a graph plugin. It uses the same storage and hook interfaces as
application plugins. [@yaks/api](../api) maps `Denied` errors to HTTP 403; a
caller can choose its own response policy.

## Compatibility

Pure TypeScript with no platform API imports. It runs on Deno, Node, browsers
and Cloudflare Workers with suitable storage and package resolution.
