# @yaks/host

The portable assembly and capabilities a host lends the plugins it composes. A
**host** composes a graph and supplies its storage, vault, blobs, artifacts,
tools, effects, caller attribution and shutdown signal. The concrete host owns
connections, directories and resource lifetime; a plugin never receives a SQL
driver or a state directory.

A plugin factory receives a `Host` and its configured options. It keeps the host
reference when its graph or tools are still being assembled:

```ts
import type { Host } from '@yaks/host'
import { equal } from '@yaks/testing'

let factory = (host: Pick<Host, 'stopping'>) => () => host.stopping.aborted
let stop = new AbortController()
let stopped = factory({ stopping: stop.signal })
equal(stopped(), false)
stop.abort()
equal(stopped(), true)
```

| Export                                        | Provides                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/host`                                  | `assembly`, facet contracts, `Host`, `Config`, `Configured`, `Options`, `Plug`, `Role`, `Feed`, `MigrationMonitor`, `Message`, `Receipt`, `Sender`, `ROLES`, `every`              |
| `@yaks/host/assembly`                         | `assembly`, `prepare`, `assemble`, `Prepared`, `Assembly`, `AssemblyOpts`, `Binding`, `Meaning`                                                                                   |
| `@yaks/host/roles`                            | Role and facet selection data without loading the assembly runtime                                                                                                                |
| `@yaks/host/senders`                          | `Message`, `Receipt`, `Sender`, `Built`, `afresh`, `Unsent`, `Undeliverable`, `Notice`, `Notices`, `Unsigned`, `Arrival`, `Incoming`, `MailDomains`, `MailDomain`, `DomainRecord` |
| `@yaks/host/lending`                          | `lending`, `Lends`: what plugins lend a host by name                                                                                                                              |
| `@yaks/host/payments`                         | `Payments`, `Plans`, `Shops`, `Door`, `Heard`, `Subscription`, `Checkout`, `Sale`, `Paid`, …: a payment provider's contract                                                       |
| `@yaks/host/words`                            | Vocabulary assembly, `wordsOf`, `taking`, `Words`, `Declared`, `Taken`                                                                                                            |
| `@yaks/host/config`                           | Configuration types, `used`, `given`, `chosen`, `configured`, `revealed`, `holding`, `Reveal`, `meet`, `Unmet`, `numbering`                                                       |
| `@yaks/host/documents`, `@yaks/host/keywords` | Shared intrinsic declarations and vocabulary keywords                                                                                                                             |
| `@yaks/host/anatomy`                          | Composition evidence, projected when read                                                                                                                                         |

## Assembly

A **facet** is a plugin's subpath, such as `./vocab` or `./graph`. A **role**
selects the facets its process serves: `graph` loads vocabulary and graph hooks,
`web` loads routes and UI contributions, `effects` loads effect handlers, and a
plugin's own role loads its service. Tool implementations load on their first
call. `Load` supplies modules or `null` for a subpath a plugin does not export;
an import failure is an error.

`assembly(config, roles, load, opts)` loads those facets and builds their
vocabulary. Its `words` lets the concrete host prepare storage before
`bind(binding)` builds the graph, effect bindings, tools, runner and routes. The
returned services are handed to the host's scheduler. `Host.defer(release)`
registers plugin resource cleanup. The concrete host stops admission through
`Host.stopping`, drains effects and services, then awaits the binding's
`close()` before closing its graph or reporter. Cleanup runs once in reverse
registration order; a failed cleanup still lets the remaining cleanups run.

A host with synchronous transactions can call `prepare(config, roles, load)`
before opening storage, then `assemble(config, roles, load, prepared, opts)`
inside its transaction. `opts.words` supplies an already-loaded `Words` value
when the host shares its vocabulary with a schema plan. `wordsOf` accepts
`{ implicit: false, keywords }` to hold a graph to its explicit declarations and
keyword vocabularies. Graph facets supply hooks and rules; vocabulary facets and
graph-owned documents supply their declarations.

A config entry's `facets` restricts which subpaths its host imports, within the
roles it serves. `{ use: '@yaks/task', facets: ['vocab'] }` loads declarations
without graph hooks, effects or tool implementations. Omitted `facets` allows
every exported facet; `[]` imports none.

A config entry's `words` selects names from its plugin's vocabulary `$defs`,
including components, tools, rules and effects:
`{ use: '@yaks/task', words:
['task', 'cancelled'] }`. Omitted `words` takes
every definition; `[]` takes none. An unknown name is an error. Selection
retains the plugin's keywords and computed-property factories. The host's
intrinsic machine, git and invocation definitions remain available where no
plugin supplies them.

`opts.docs` supplies the graph's own vocabulary documents. Its component
declarations replace plugin declarations and extensions of the same name;
extensions in `opts.docs` still add to plugin components. Duplicate plugin
declarations are errors even when the graph shadows that name.

The complete in-memory binding example runs in
[`assembly_example_test.ts`](./assembly_example_test.ts), where it binds the
host, writes a book through the graph and reads it back. The vocabulary plan is
prepared independently of those binding and graph operations.

```ts
import { assembly } from '@yaks/host'

// const plan = await assembly(config, ['graph'], load, { docs })
// const { host } = plan.bind(binding) // host-supplied storage, effects and resources
// await host.graph.apply([{ entity: { eid: 'b' }, book: { title: 'Dune' } }])
```

`Binding.storage` receives the host and a shared query-extension list. After
storage binds, the assembly adds plugin extensions, then `Binding.extend` adds
the host's own compilers. `Binding.install` prepares schema before graph-facet
installers run. `Binding.graph` can add the host's own hooks and graph options
around the contributed plugins. `Binding.clock` (an @yaks/fp `Clock`) is the
clock the graph and the tool runner keep, each its own when it is absent.
`Binding.ready` lends graph-dependent capabilities before effect factories run.
`Host.meaning` ranks words by meaning among what a filter line admits: the index
a plugin's graph facet offers, or one the binding lends in `Binding.host`, never
both. `Binding.search` combines the host's text search with it.

## Storage capabilities

`Host.storage` is [graph storage](../graph/README.md#storage), not a particular
backend. SQL-backed storage may offer a
[statement capability](../sql/README.md#statement-capability) for indexes beside
the graph. It also may offer bound storage diagnostics and a migration monitor.
A plugin needing an absent capability reports that fact rather than guessing a
connection or a file location.

Storage is bound before query extensions are asked for. The graph, request
handler, tool runner and duties become available as composition builds each one.
Factories retain the host reference and use those parts only after their factory
returns.

## Required plugins

A plugin can shape a store so that only it reads and writes the store's rows
correctly from then on: [@yaks/blob](../blob/README.md) keeps an address where a
body's text was. Its graph facet says so with `required(options)`, which may
depend on its options, so a plugin can require itself only under the option that
shapes its rows. `Assembly.required` names every plugin of a composition that
says so. A writing host records them in the store before it writes, and every
host, reading or writing, refuses a store whose recorded requirements its config
does not compose: `meet(config, requirements)` throws `Unmet`, a `CallError`
naming each plugin missing. A plugin listed with its `graph` facet left out is
not composed.

A plugin removed from a store on purpose leaves the config and drops its
requirement from the store, which for a SQLite store is one statement
([@yaks/sqlite](../sqlite/README.md#the-plugins-a-store-requires)).

## Workspaces and sandboxes

`Host.workspaces.connect(id)` opens an existing file-and-command workspace at
its recorded placement. It never chooses the graph server's directory.
`Host.sandboxes.request(id, request?)` records a sandbox intention before
provisioning; it requires an explicitly configured adapter or default provider.
Sandbox effects provision that intention. Missing configuration refuses rather
than creating a local directory. `Host.resolveHome(session)` may prepare a
configured native fixer's worktree independently of sandbox provisioning.

A session's `home{workspace, cwd}` is a default target, not a permission grant.
Changing it, stopping a session or closing a host does not dispose its
workspace. Only explicit sandbox disposal destroys a resource. See
[@yaks/machine](../machine/README.md) for execution and
[@yaks/sandbox](../sandbox/README.md) for lifecycle and adapter configuration.

## Mail senders

`Host.senders` lends named
[senders](../mail/README.md#the-transport-is-supplied-by-the-caller).
`@yaks/mail` selects one with `sender: {via: name}` in its plugin options. The
host constructs its own and owns their credentials, metering and lifetime. A
provider plugin lends one too, from its graph facet's `senders(host, options)`,
built from its own options. One name has one sender: two parties lending a name
fail composition. `afresh(build)` (`@yaks/host/senders`) makes a sender that
builds again at every use, and says through `waiting()` why it cannot send yet,
so a letter waits for a credential instead of bouncing. `Message.id` is the
caller's letter UUID, for an asynchronous receipt. `Incoming` is a
provider-neutral letter with headers, text and attachments; a provider supplies
an authentication verdict separately from the author's headers. The assembly
passes this capability to plugin factories through `Binding.host` or
`Binding.ready`. A sender rejects with `Unsent` (`@yaks/host/senders`) when the
message certainly never left, so mail tries it again instead of bouncing it, and
with `Undeliverable` when its provider refused an address on the letter, so mail
bounces it as the letter's outcome rather than a failure of the sender.

```ts
import type { Host, Message } from '@yaks/host'
import { post } from '@yaks/mail/effects'
import { equal } from '@yaks/testing'

let sent: Message[] = []
let host: Pick<Host, 'senders'> = {
  senders: {
    platform: {
      send: (message) => {
        sent.push(message)
        return Promise.resolve({ id: 'letter-1' })
      },
    },
  },
}
let { sender } = post({ via: 'platform' }, host)
let receipt = await sender!.send({
  from: 'hello@books.example',
  to: 'ana@example.com',
  subject: 'Friday',
  text: 'Bring a dish.',
  html: '<p>Bring a dish.</p>',
})
equal(receipt, { id: 'letter-1' })
equal(sent.map((message) => message.subject), ['Friday'])
```

## Hosts that route mail themselves

A host that composes no graph, such as a Worker, names its mail providers in a
config too, and asks their graph facets with `lending` (`@yaks/host/lending`)
for what each lends by name: `senders`, the `notices` readers of a provider's
signed word about a letter it carried (a `Notice`: the receipt, and the tags the
letter was sent with, which say whose it was), and the `arrivals` that read a
letter the runtime handed the host, in the runtime's own shape, as an
`Incoming`. A request its provider did not sign rejects as `Unsigned`. Its
`mailDomains` set a domain up for sending and receiving (`setup`), read the DNS
records it needs with whether each has `arrived` (`read`), and `remove` it, each
domain named by its domain name, never the provider's id for it. The host reads
each option a config writes as a reference through `configured(config,
reveal)`:
`{"secret": NAME}` and `{"binding": NAME}`, read when accessed; `holding(env)`
reads both from a Worker's env.

## Embedders

`Host.embedders` lends named in-process embedders the same way:
`@yaks/embedding` selects one with `embedder: {provider: name, model, dim?}`,
and a provider plugin lends one from its graph facet's
`embedders(host, options)`, as `@yaks/model2vec` lends `model2vec`. An
`Embedding` makes an embedder from the `model` and `dim` a config names; the
embedder's `model` names its vector space, and nothing loads until its first
embed. One name has one embedder.

## Texters

`Host.texters` lends named texters to @yaks/phone's `sender: {via}` the same
way: a provider plugin lends one from its graph facet's `texters(host, options)`
(@yaks/phone/plugin builds it), and a texter that cannot send yet says why
through `waiting()`.

## Payment providers

A host that takes money itself asks for `payments` the same way: a provider
plugin lends a `Payments` from its graph facet's `payments(host, options)`, its
`name` for the sentences people read, its `plans`, its `shops` and its webhook
`doors` (`@yaks/host/payments`), functions over its own wire that answer in
words naming no provider. `plans` mints a payer once, says whom it is billed to,
opens a hosted checkout for a tier by the month or year (with a trial for time
already given free) and a hosted portal, reads a subscription as
`{id, payer, tier, status, until,
ending, tags}` and moves its next charge. The
provider decides which tier a price buys and where a status stands (`standing`:
`paying`, `owing`, `lapsed` or `ended`); the host keeps its own rules over them.

`shops` is a party selling on an account of its own: it opens the account once
(`{account, ready, submitted}`, ready only once the provider lets it take
payments), answers the address of the provider's onboarding for it, opens a
hosted checkout on it for a sale (its lines, currency, the host's fee and the
tags that ride the checkout and its payment). The host keeps the fee, the cart
and the order.

`doors` are where the provider posts what happened, by name; a host serves each
at `/<via>/<name>`, `via` the name the provider is lent under. A door verifies
one request and answers what it heard (`{heard}`) or why it refused it
(`{refused, ours}`, `ours` where the host's own secret may be wrong), and
nothing where it holds no secret. What it heard is a `Heard` in the host's
words: a subscription changed (`about: 'subscription'`, the subscription read on
asking), or, on a seller's account, the seller changed, the seller revoked the
host, a checkout completed (`Paid`), or a payment was refunded, disputed, lost
or restored, its payment and tags read on asking. @yaks/stripe lends one.

## Failure reporting

`Host.report(error, context)` hands a failure to the concrete host's reporter.
Context identifies the failing work through `during.entity`, `during.kind`,
`during.session` and `during.process`; `eid` preserves an occurrence's identity
across redelivery. The host owns delivery and shutdown, so plugins use its
reporter without opening a sink.

```ts
import { equal } from '@yaks/testing'
import type { Host } from '@yaks/host'

let told: unknown[] = []
let host: Pick<Host, 'report'> = {
  report: (error) => {
    told.push(error)
  },
}
await host.report?.('missing field', { during: { entity: 'work' } })
equal(told, ['missing field'])
```

## Concrete hosts

[@yaks/cli](../cli/README.md) opens the box's database and binds this interface.
Its caller owns shutdown and closing. This package imports no CLI, native
storage implementation or filesystem API. It owns the shared assembly and
contract; the box owns its loader, command line and resource provisioning.
