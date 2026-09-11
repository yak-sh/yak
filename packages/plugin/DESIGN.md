# Package contribution and command composition pilot

## Goal

One installed package can supply several subsystems. A standalone application
and a daemon-backed application use the same contributions. Hosts choose
placement; plugins declare what they provide and which capabilities they
require.

This pilot adds a small manifest selector and structured command adapters. It
does not implement a daemon, service supervisor, package installer,
configuration-file search, hot reload, or a new command prompt.

## What is implemented

- `@yaks/plugin`: explicit installed-module loading, version-1 manifests, lazy
  target selection, capability checks, and identity validation.
- `@yaks/cli/structured`: noun-path/verb identities around the existing
  `@yaks/graph` Tool schema, annotations, execution context, and handler.
- `@yaks/harness/plugin`: session vocabulary, session graph rules, and a session
  list command. This is a partial manifest, **not everything required to boot
  the harness**. Model/tool/context vocabulary and derived columns still come
  from the existing host composition.
- `harness session list` and the explicit alias `harness list session` are wired
  into the existing executable. They return session bundles as JSON. Existing
  short commands such as `ls` are unchanged.
- The same command becomes MCP `session_list` by passing
  `commandTools(commands)` to the existing MCP server. An in-memory MCP
  client/server regression exercises this path; the harness does not start a new
  MCP listener automatically.

Two consumers can select vocabulary and commands from one loaded manifest
without loading a service factory. No daemon or extra executable is required.

## Structured commands

```ts
{
  noun: ['session'],
  verb: 'list',
  aliases: [['list', 'session']],
  description: 'List sessions in the connected graph.',
  input: {},
  readOnly: true,
  run: (_args, ctx) => ctx.read(parse('.session')),
}
```

The command runs against an injected `ToolCtx`. Its authenticated actor and
`read`/`apply` functions come from the host, not user-supplied command
arguments. Authorization remains the responsibility of that context and graph
rules.

Canonical CLI spelling is noun-first. Alternate order is explicitly registered;
there is no natural-language parser. The MCP name joins canonical words with
underscores. Words may contain lowercase letters, digits, and hyphens, but not
underscores. Duplicate paths and prefix-ambiguous paths are rejected before
registration, rather than resolved silently by install order.

A three-word command could use `noun: ['repo', 'branch'], verb: 'create'`. The
repository instance is a structured input argument, not part of command
identity. Likewise an authorization scope is execution context, not a freely
chosen subject.

CLI argument decoding, validation, and output formatting still belong to the CLI
adapter. This pilot's command has no arguments and rejects extra words. Its MCP
adapter uses the existing graph Tool schema machinery. We deliberately have not
introduced a second argument/schema compiler. A command with arguments is the
next useful test before extracting a separate `@yaks/command` package.

The structured registry validates collisions **within the supplied set**. Mixing
it with existing CLI plugins still uses the old CLI precedence rules. A complete
installed registry should validate the combined names before activation; that
integration is not claimed here.

## Host composition and configuration

An installed configuration contains plugin IDs and exact module specifiers. A
host validates the config, resolves all manifests, selects its targets,
validates the resulting payloads, then activates them. Importing a manifest must
not start work. Host-specific factories use dynamic imports so vocabulary
consumers do not load native drivers or terminal code.

Use one resolved configuration snapshot per system startup. A future installer
may write it, but must not silently execute discovered repository plugins or
activate newly downloaded code. Plugin version resolution/lockfiles belong to
that installer or resolver. `api: 1` only versions the manifest envelope, not
the payload contracts of each subsystem. Payload contracts need their own
versioning policy before third-party ABI stability is promised.

A proposed configuration layering policy is defaults, explicit config file, then
explicit command-line overrides. It is design-only; the pilot accepts a resolved
array and does not read any config file. Unrecognized placement or requirements
must fail visibly rather than fall back to a different execution host.

## Placement does not belong in plugins

Possible compositions:

| Subsystem                         | Standalone                   | Daemon-backed                |
| --------------------------------- | ---------------------------- | ---------------------------- |
| Commands and terminal views       | CLI                          | CLI                          |
| Authoritative graph rules/effects | Local backend                | Daemon backend               |
| Shared vocabulary                 | Backend and frontend replica | Backend and frontend replica |
| Frontend-local rules/effects      | Frontend                     | Frontend                     |
| HTTP service                      | Explicit host configuration  | Explicit host configuration  |

`graph.plugins` is deliberately an existing graph-plugin contribution, not a
special daemon interface. Domain and frontend-local graph targets must be
separated by the composing host as the manifest grows; not all effects move to a
daemon. Renderers keep query specificity within their existing registry.

Service placement configuration may eventually choose process, worker, or child
process. A service declaration should identify configuration and capabilities; a
separate host adapter should own startup, readiness, shutdown, and failures.
This pilot does not invent a service lifecycle API without exercising one.

Starting a daemon must not implicitly produce two executors for the same store.
A future handoff must stop admission, drain or explicitly interrupt current
work, release ownership, then let the other host acquire it. Client
disconnection must not terminate daemon-owned work. A connectivity timeout alone
does not authorize starting a replacement local executor. None of this lifecycle
is implemented by the manifest selector.

## Migration and rollout

Extract one domain at a time into packages, initially consumed by the existing
server. Test vocabulary and data migrations on isolated database copies. Compose
the same domain in the new host before switching authoritative execution.

The migration-announcement protocol only protects migrations explicitly using
it, and its polling grace period is cooperative. Package installation is not
permission to run an unannounced schema upgrade. An older host must not repair a
new schema back to an old vocabulary during plugin activation.

## Open decisions and rough edges

- `select` returns `unknown` payloads. It avoids false type safety across
  dynamic imports but needs receiver validators or typed target descriptors for
  good ergonomics. This should be designed using a second consumer, not solved
  with unchecked generic casts in public APIs.
- Contribution requirement strings are checked capabilities, not security
  permissions, dependency injection keys, or process names.
- The new package is called plugin; the graph and CLI already use `Plugin` for
  their own registrations. Documentation must distinguish manifests from
  payloads rather than renaming existing APIs prematurely.
- Cross-plugin command collisions are checked when the entire command set is
  adapted; other subsystems retain their established merge/override semantics.
- The first CLI example still uses the existing harness runtime factory, which
  starts more machinery than a read-only command strictly needs. This pilot does
  not hide that host-lifecycle debt behind a new wrapper object.
- There is no `:` adapter yet. It should use `resolveCommand`, a host-supplied
  argument decoder, and the same handler rather than duplicate business logic.
- Compiled distributions should assemble selected imports at build time. Do not
  promise arbitrary post-install module loading without testing the chosen
  runtime's support. Source installations can use an explicit module resolver.

Next iteration: add a command with validated arguments, receiver-side typed
target contracts, and one host activation lifecycle. Do not migrate every
command or add service placement syntax before those examples establish what is
needed.
