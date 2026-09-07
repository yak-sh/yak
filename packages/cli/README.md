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

## What it is

There is no list of verbs in this package. It asks the server for `tools/list`
and every tool it gets back is a subcommand:

```sh
yak app_list
yak app_files --app recipes --path index.html --content @index.html
yak graph_query --q '.recipe!'
```

So the CLI cannot drift from the connector an agent is talking to, and a tool a
release adds is a subcommand the day it ships — without publishing this package
again.

Four verbs are the command's own and shadow a tool of the same name: `help`,
`login`, `logout`, `apply`.

## Plugins

Everything else arrives through a plugin, and a plugin is data: a name, the
heading its verbs sit under, and a table of verbs contributed at boot.

```ts
import { main, type Plugin, PLUGINS } from '@yaks/cli/yak'

let mine: Plugin = {
  name: 'mine',
  about: 'this box’s own verbs',
  verbs:
    () => [{ name: 'ping', about: 'say hello', run: (c) => (c.out('hi'), 0) }],
}

Deno.exit(await main(Deno.args, [mine, ...PLUGINS]))
```

`yak --help` renders every table on one page, one column throughout. The
**first** plugin to name a verb wins, so the order is the precedence and a box
that adds its own decides where it sits. A plugin is asked for its table only
until the word is found, so one that has to reach the network for its verbs
costs nothing on a line that never reaches it.

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

The words the tool said, on stdout. `--json` prints its structured result
instead:

```sh
yak graph_query --q '.recipe!' --json | jq '.[].doc.title'
```

Exit codes: `0` said, `1` the tool or the door refused, `2` the command line was
wrong.

## Signing in

The bearer is `$YAKS_TOKEN` when it is set — which is how a sandbox hands one
over with no file to write — and otherwise the one `yak login` wrote, at 0600
under this OS's config directory:

```sh
yak login <token>     # remembered for this host
yak logout            # forgotten
```

A 401 answers with the one sentence to act on, not an OAuth flow: this is a
command line and it has no browser to follow a challenge with.

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

`yak apply` is `graph_apply` with a door for a stream. A batch is atomic, and a
file of bundles is a load rather than one batch, so NDJSON — one bundle per line
— goes over in batches of 50:

```sh
cat bundles.ndjson | yak apply
yak apply @bundles.ndjson
yak apply --change '[{"entity":{"eid":"$r"},"doc":{"title":"Lemon cake"}}]'
```

## Dependencies

None. The three JSON-RPC calls this makes — `initialize`, `tools/list`,
`tools/call` — are smaller than the SDK that would answer them, so a
`deno install` of this pulls nothing else down.
