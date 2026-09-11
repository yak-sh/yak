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
- `@yaks/cli/structured`: noun/verb traversal of the existing `@yaks/graph` Tool
  schema, annotations, execution context, and handler.
- `@yaks/harness/plugin`: session vocabulary, session graph rules, and a session
  list command. This is a partial manifest, **not everything required to boot
  the harness**. Model/tool/context vocabulary and derived columns still come
  from the existing host composition.
- `harness session list` and the verb-first traversal `harness list session` are
  wired into the existing executable. They return session bundles as JSON.
  Existing short commands such as `ls` are unchanged.
- The same command becomes MCP `session_list` by passing
  `commandTools(commands)` to the existing MCP server. An in-memory MCP
  client/server regression exercises this path; the harness does not start a new
  MCP listener automatically.

Two consumers can select vocabulary and commands from one loaded manifest
without loading a service factory. No daemon or extra executable is required.

## Structured commands

```ts
{
  noun: 'session',
  verb: 'list',
  description: 'List sessions in the connected graph.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  readOnly: true,
  run: (_args, ctx) => ctx.read(parse('.session')),
}
```

The command runs against an injected `ToolCtx`. Its authenticated actor and
`read`/`apply` functions come from the host, not user-supplied command
arguments. Authorization remains the responsibility of that context and graph
rules.

Noun and verb belong to the graph `Tool` contract. They are single strings, not
paths or aliases. Both `session list` and `list session` resolve the same tool.
Completion after `list` shows nouns with that verb; after `session` it shows
that noun's verbs. The first two words resolve identity before positional
arguments are interpreted. Registries reject ambiguous reversed pairs. Existing
named tools remain supported by transports without inventing nouns for them.

The portable declaration is JSON Schema-validated by `@yaks/vocab/tools`. Its
physical placement inside `vocab.json` remains open: the pilot uses a small
standalone JSON fixture, not a mandated document layout. Tools are not tied to
components. Input properties define options, constraints and defaults;
`options.positional` lists positional field names and `options.short` maps short
flags to properties. Ordinary long flags require no extra registration. Objects
and arrays are JSON CLI values; union coercion and shell completion integration
are outside this small parser. CLI and MCP validate with the same JSON Schema
validator. MCP advertises the original schema; provider declarations reuse it.
Legacy Zod-shaped `input` bags remain compatible but cannot accompany an
`inputSchema`. No handler execution framework was added.

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
- The structured read-only CLI opens storage without constructing the agent
  runtime or starting model execution. Existing short commands retain their old
  runtime path; migrating them is outside this pilot. Opening storage still runs
  the existing host initialization and migration policy.
- There is no `:` adapter yet. It should use `resolveCommand`, a host-supplied
  argument decoder, and the same handler rather than duplicate business logic.
- Compiled distributions should assemble selected imports at build time. Do not
  promise arbitrary post-install module loading without testing the chosen
  runtime's support. Source installations can use an explicit module resolver.

Next iteration: add a command with validated arguments, receiver-side typed
target contracts, and one host activation lifecycle. Do not migrate every
command or add service placement syntax before those examples establish what is
needed.

## Revised tool pilot boundaries

Tool identity is now directly on `@yaks/graph.Tool`, not a separate Command
shape. `@yaks/vocab/tools` is a lazy optional entrypoint for JSON Schema
declarations and validation; importing the graph core does not load Ajv. The
complete repository type check and focused mixed-registry tests cover legacy
named/Zod tools alongside noun/verb JSON Schema tools. The demonstration
`session-list.json` is a fixture, not a decision to require another root file.

The declaration schema and inputs use draft 2020-12. Output-schema migration,
provider-wide enumeration of all installed contributions, shell completion
installation, and merging collision policy with unrelated legacy CLI plugins
remain open. `completeCommand` exposes the two traversal directions to adapters;
it does not install shell completion scripts. The MCP SDK adaptation uses a
static listing projection when raw JSON Schema tools are present, so hosts must
rebuild that server to change its registry.
