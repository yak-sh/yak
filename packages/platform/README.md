# @yaks/platform

Defines graph components for a hosting platform's applications, deployments,
customer spaces, billing usage, sign-ins, and error reports. This is a JSON
Schema vocabulary, not a deployment server or billing implementation.

`space` is what a customer owns; `app` is what lives in it; `deploy` is one
release of that app, and `published` is the name it was released under;
`hostname` is a domain pointed at it, and `installed` records the source app and
version of a copy; `plan` is what is being paid for, and `meter` is the usage it
is billed on; `signin` is a sign-in in progress, and `report` is an error a
deployed app reported.

An entity is a record identified by `entity.eid`; each of the names above is a
component, a named object on that record. `deploy.files` and `deploy.worker` are
strings supplied by the application. The vocabulary does not upload files,
configure DNS, send sign-in emails, charge customers, or enforce access policy.
Those operations are implemented by the application in `workers/yak`.

## Exports and example

The root import exports `platformDoc`. `@yaks/platform/vocab` also exports
`docs: [platformDoc]` for plugin loaders. Load these declarations into a graph
and use its storage adapter to save the records:

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

## Compatibility

Deno and Node — a JSON document, with no runtime calls.
