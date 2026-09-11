# @yaks/plugin

An experimental registry for explicitly configured package contributions. A host
loads manifests and selects the contributions needed by one subsystem. A
manifest can supply vocabulary, commands, graph plugins, or views without
deciding which process runs them.

This package does not install packages, start services, open a graph, or
discover code in the current directory. The host supplies a module resolver and
controls activation. The interface is a small composition pilot, not a stable
extension ABI.

## Example

```ts
import { load, select } from '@yaks/plugin'

const installed = [{
  id: '@yaks/harness',
  specifier: 'jsr:@yaks/harness@0.1.0/plugin',
}]
// The example specifier illustrates the published layout; availability depends
// on the installed package version exporting ./plugin.
const plugins = await load(installed, (specifier) => import(specifier))
const vocabulary = await select(plugins, 'vocabulary')
const commands = await select(plugins, 'commands')
```

Each selected result carries `plugin`, `name`, and `value`. The receiving
subsystem checks `value` against its own contract before registration. Commands
and graph plugins keep their existing APIs; this registry does not wrap their
execution.

## Manifest

```ts
import type { Manifest } from '@yaks/plugin'

const plugin: Manifest = {
  api: 1,
  id: 'example',
  contributions: [{
    name: 'http',
    target: 'services',
    requires: ['listen'],
    load: () => import('./http.ts'),
  }],
}
export default plugin
```

Factories run only when their target is selected. Requirements are checked
before any selected factory runs. They describe capabilities, not locations: a
CLI host and a daemon host can both provide `listen`.

`load` preserves configuration order, ignores disabled entries, and rejects
incompatible manifest API versions, identity mismatches, duplicate enabled
plugin IDs, and duplicate contribution names within a plugin. `select` preserves
that order and returns all matching contributions. It does not resolve semantic
collisions: the receiving command/vocabulary/view registry owns those rules.

The resolver is injected deliberately. It can use a pre-imported allowlist,
validated configuration, or dynamic imports. It must enforce the host's version
pinning and trust policy. Importing arbitrary code grants it the host's
privileges; manifest requirements are not a sandbox. A factory must be
declarative and free of activation side effects, but JavaScript imports cannot
enforce this promise.

Selection does not cache factories or roll back their side effects. Register
once per host instance, and keep activation separate from selection. A rejected
load must prevent that host from activating its partially assembled registry.

See [DESIGN.md](./DESIGN.md) for process placement, shared commands, and the
explicitly deferred parts of this pilot.
