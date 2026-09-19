# @yaks/cli

The `yak` command: an MCP server's tool list, read at run time, with every tool
a subcommand.

## Install

```sh
deno install -gf --allow-net --allow-env --allow-read --allow-write jsr:@yaks/cli/yak
```

That gives you `yak`. (`npx` and `bunx` reach JSR through its npm bridge at
`npm.jsr.io` — configure the `@jsr` scope and the package is `@jsr/yaks__cli` —
but Deno is the supported install, and the one this is tested against.)

## Server tools

There is no list of verbs in this package. It asks the server for `tools/list`
and every tool it gets back is a subcommand:

```sh
yak app_list
yak app_files --app recipes --path index.html --content @index.html
yak graph_query --q '.recipe!'
```

Server tools become commands without a CLI release. Tool discovery depends on
the selected server and its cached tool list.

Four tools are the command's own and shadow a server tool of the same name:
`help`, `login`, `logout`, `apply`.

## Plugins

Everything else arrives through a plugin, and a plugin is data: a name, the
heading its tools sit under, and a table of tools contributed at boot.

A tool here is a @yaks/graph `Tool` and nothing else — noun, verb, description,
`inputSchema`, `run` — the same declaration an MCP transport lists. What a CLI
tool is handed is this package's `Ctx` and what it answers with is an exit code,
which is what `Tool<Ctx, number>` says. There is no second shape.

```ts
import type { Tool } from '@yaks/graph'
import { type Ctx, main, type Plugin, PLUGINS } from '@yaks/cli/yak'

let mine: Plugin = {
  name: 'mine',
  about: 'local commands',
  verbs: (): Tool<Ctx, number>[] => [{
    name: 'ping',
    description: 'say hello',
    inputSchema: { type: 'object', additionalProperties: false },
    run: (_args, c) => (c.out('hi'), 0),
  }],
}

Deno.exit(await main(Deno.args, [mine, ...PLUGINS]))
```

The tool's own input schema is the whole grammar of the line: `argsFor` fills
`options.positional` from the bare words, then `options.rest`, reads
`--name value`, `--name=value` and a declared short `-n`, inflates `@path` and
`-`, and checks the bag against the schema, which is also what fills its
defaults. The usage line and `--help` page are drawn from that same schema.

`yak --help` renders every table on one page, one column throughout. The
**first** plugin to name a word wins, so the order is the precedence and an
application chooses precedence through plugin order. A plugin is asked for its
table only until the word is found, so one that has to reach the network for its
tools costs nothing on a line that never reaches it.

Two plugins ship here: the server's tools (above), and the apps' commands.

## An app's own commands

An app declares commands rather than tools, so the tool list never moves for
them. `yak commands` lists them, and either spelling runs one:

```sh
yak command add_recipe --app recipes title='Lemon cake' serves=4
yak recipes add_recipe title='Lemon cake' serves=4
```

The second is what a first word nothing else claimed means: an app, then its
command. The arguments are the app's own, so they are `key=value` words — JSON
where the value parses as JSON, `@path` and `-` as everywhere else — which is
what keeps them apart from this program's own options.

## Arguments

A tool's own input schema is the grammar. `--name value` names a property, and
what the schema says that property IS decides what the word becomes: a `string`
stays the word it is, JSON-looking or not; an `object`, `array`, `number` or
`boolean` parses. Repeat an option to build a list.

Three spellings inflate a value first, because a body is rarely something you
type:

| you write            | it sends              |
| -------------------- | --------------------- |
| `--content hello`    | `hello`               |
| `--content @page.md` | that file's text      |
| `--content -`        | stdin                 |
| `--name=--weird`     | a value starting `--` |

A name the tool does not declare, a value its type cannot be, and a required
argument nobody gave are all refused here, before the round trip.

## Output

Tool text is written to stdout. `--json` prints its structured result instead:

```sh
yak graph_query --q '.recipe!' --json | jq '.[].doc.title'
```

Exit codes: `0` success, `1` tool or transport error, `2` invalid command-line
arguments.

## Signing in

The bearer token comes from `$YAKS_TOKEN` when set, otherwise from the file
written by `yak login` with mode 0600 in the OS config directory:

```sh
yak login <token>     # remembered for this host
yak logout            # forgotten
```

A 401 reports an authentication error. The CLI does not launch an OAuth browser
flow; supply a valid token and retry.

## Which server

`yaks.app`, unless `$YAKS_HOST` or `--host` says otherwise. A bare name becomes
`https://<host>/mcp`; a whole origin is taken as given, so a `--host` of
`http://localhost:8787` aims at one you are running.

## Help

```sh
yak help              # every tool, one line each
yak help graph_query  # that tool's arguments, off its own schema
```

The tool list is cached per host and stamped with the roster version the server
names in `about`. Nothing checks that version — checking would cost the round
trip the cache saves. It is dropped on the two signals that arrive for free: a
result carrying the server's roster line, and an `about` naming a version the
cached list is not.

## apply

`yak apply` is `graph_apply` with streaming input. A batch is atomic, and a file
of bundles is a load rather than one batch, so NDJSON — one bundle per line —
goes over in batches of 50:

```sh
cat bundles.ndjson | yak apply
yak apply @bundles.ndjson
yak apply --change '[{"entity":{"eid":"$r"},"doc":{"title":"Lemon cake"}}]'
```

## Dependencies

The runtime uses native fetch and implements `initialize`, `tools/list` and
`tools/call` without an MCP SDK dependency. Command execution and credential
storage require Deno filesystem, environment and network permissions.

## Structured command pilot

`@yaks/cli/structured` consumes graph `Tool` definitions with string `noun` and
`verb` fields. `session list` and `list session` automatically traverse the same
registry; they are not separately registered aliases. `completeCommand` lists
matching nouns or verbs. `resolveCommand` resolves the first two words, and
`argsFor` decodes the remaining arguments against `inputSchema`.

Long options derive from JSON Schema properties. Optional `options.positional`,
`options.short` and `options.rest` metadata describe positional fields, short
flags, and the property the leftover bare words fill. Shared validation applies
types, bounds, enums, required fields and defaults. The CLI adapter supplies
execution context; the handler remains the graph Tool's `run`.

MCP and provider adapters derive a name such as `session_list` when no explicit
transport name is present. Existing name-only tools remain supported. JSON
Schema tool declarations are available through `@yaks/vocab/tools`; where they
belong within vocabulary documents remains an open design question.
