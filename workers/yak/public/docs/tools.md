---
doc:
  title: App Commands
guide:
  slug: tools
  brief: commands an app declares for an agent to call
  description: >-
    Tool entries in vocab.json that let the person's agent act on an app with
    no page open: the generated add_ and find_ commands, an entry's
    description, its argument schemas and $var bindings, the apply and query
    actions, what a deploy refuses, commands a model may call, the view page an
    answer is rendered in, and how the commands and command MCP tools list and
    run them.
---

# App Commands

An app's pages work only while someone has them open. A command works with no
page open: an entry in `vocab.json` marked `"tool": true` declares a command the
person's agent can call, such as log a run, read the leaderboard or close a
shift. This page covers that entry: what it declares, how `$var` variables are
bound and typed, the two actions, what a deploy refuses, the page a command's
answer is rendered in, and how the `commands` and `command` MCP tools list and
run commands.

## When to declare a command

The graph tools (`graph_apply`, `graph_query`) can already write anything. They
do not describe what this app is for. A declared command gives the agent a
one-sentence description the model selects the command by, typed arguments, and
a template written once, so no caller has to know that a run is
`jog{who, miles}` on a new entity. The command is listed for everyone else in
the space too, so every member of the space can call it.

To store a new kind of data, declare a new component, not a new command.
`graph_apply` already writes any component the vocabulary declares, so data an
app needs to keep, such as a `rating`, a `loan` or a `shift`, is one entry in
its `vocab.json`, and `graph_schema` lists it for everyone as soon as the app
deploys. Declare a command only when the app needs an action that another
person's agent can call. Each command adds one more name to the `commands`
listing that a model has to choose between.

## Generated `add_` and `find_` commands

`app_deploy` generates two commands for every component an app's `vocab.json`
declares, treating each component as a kind of thing the app is about: one
command adds an entity of that kind, and one finds such entities again:

    vocab.json  { "$defs": {
                    "recipe": { "properties": {
                      "serves":  { "type": "number" },
                      "cuisine": { "type": "string" } } } } }

    →  add_recipe    title, body, alias, serves, cuisine
       find_recipe   words, serves, cuisine, limit

`add` creates an entity with that component, a `doc` for the title and body, and
an `alias`: a name the entity can be reached by, so a later call can find it
without having kept the eid. Only `title` is required; a property left out of
the call is not written. `find` builds a query string over the same properties:
`words` is a full-text search over the title and body, each property is an
equality test, and every clause whose argument is left out is dropped from the
query, so `find` with no arguments returns every entity of that kind.

**The generated commands let an agent find the app later.** A person who asked
for a recipe box in one conversation may say "add this recipe" in a later one,
to an agent that has never seen the app. Every agent looks in `commands` for
what the person's yaks apps can do, so the generated commands list the app there
even when nobody declared a command for it.

There are three ways to change the generated commands:

- **Opt out** — `"tools": false` at the top of `vocab.json`, beside `$defs`. The
  app declares its components and gets no generated commands at all.
- **Exclude one component** — `"kind": false` on that component. Use it for a
  mark an entity carries rather than a thing someone adds, such as `starred` or
  `paid`: that component gets no generated commands, and the file's other
  components keep theirs.
- **Override** — declare a tool named `add_recipe` or `find_recipe` yourself.
  Your entry replaces the generated one entirely: its description, arguments and
  template are yours. A declared command can describe what the app is for; a
  generated one describes only what it stores.

Each deploy regenerates these commands from the current `vocab.json`, so a
property added to a component becomes an argument of both its generated
commands.

## Declaring a command in vocab.json

A command is a `$defs` entry of `vocab.json` (or `vocab.yml`) marked
`"tool": true`, beside the components it writes: the same form a yaks package
declares its own tools in. The entry's key is the command's name, so a command
cannot have the same name as a component:

    { "$defs": {
        "jog": { "properties": {
          "who":   { "type": "string" },
          "miles": { "type": "number" } } },
        "log_run": {
          "tool": true,
          "description": "Log a run for the club leaderboard",
          "input": { "who":   { "type": "string" },
                     "miles": { "type": "number" } },
          "required": ["who", "miles"],
          "apply": { "entity": { "eid": "$run" },
                     "jog": { "who": "$who", "miles": "$miles" } } } } }

`app_deploy` installs the command. Every deploy replaces the app's commands
entirely: a declaration stores no rows, so there is nothing to migrate, and an
entry removed from `vocab.json` is a command the app no longer has after the
next deploy. A `tools.json` file, where commands used to be declared, is refused
at deploy, with a message that says where each of its entries goes now.

## Command names, listing and calling

A command's name is exactly the entry's key, `log_run`, not one prefixed with
the app (`runs__log_run`). A command is not an MCP tool and never appears in the
connector's tool list. Two fixed MCP tools serve every app's commands:
**`commands`** lists the available commands and **`command`** runs one, with the
app passed as a separate argument rather than joined into the command's name.

    command { name: 'log_run', args: { who: 'Ada', miles: 5 } }

`args` holds the command's own arguments, named as `commands` lists them. Pass
`app` beside them only when two apps you can reach have a command with the same
name.

An app page can ask `GET ./api/commands` for its own commands. The response is
an object keyed by command name, with each command's `description`, `input`,
`required` and `model` fields. It includes only commands this visitor may
discover and call, using the same access rule as `POST ./api/command`. A page
can use it to build its own command menu without copying that access rule.

**The connector's tool list is fixed.** A directory such as OpenAI's takes a
snapshot of `tools/list` on the day a connector is submitted and serves that
snapshot from then on; only `tools/call` reaches the live server
(<https://developers.openai.com/plugins/deploy/app-review>). So this connector
lists the same tool names, in the same order, for every caller, signed in or
not. A tool name added by a deploy after the submission would never appear in
that snapshot. The `commands` and `command` tools let an app's own actions reach
an agent through a tool list that does not change.

The deploy reports the command names it registered:

    deployed yourname/runs v3: https://yourname.yaks.app/runs/
    commands: log_run, leaderboard, since

**A caller sees the commands of every app in every space they belong to.** A
`public` or `open` app in a space they do not belong to can be reached on the
web but not through a command: a command names its app by slug, and outside the
caller's spaces there is no space to resolve that slug in. Two apps in two of
the caller's spaces can have commands with the same name; both are listed, and a
call that names neither app is refused with the candidates:

    log_run is a command of club/runs and yourname/runs — say which app

A call to a name that no reachable app has is refused with the list of commands
that do exist, because each person's command list is different and no model can
know it in advance:

    no command add_run — your apps offer yourname/runs: log_run, leaderboard,
    since. commands lists them with their arguments.

`commands` groups them by app and lists each one's arguments the way `command`
accepts them, with a `?` on an optional argument. Its `app` argument — a slug,
or `<space>/<app>` where two spaces both have an app of that name — narrows it
to a single app; leave it out to list every app you can reach:

    ## yourname/runs
    log_run(who, miles) — Log a run for the club leaderboard — Run club, an
      app at yourname.yaks.app/runs/

    ## yourname/recipes
    add_recipe(title, body?, alias?, serves?) — Add a recipe to yourname/recipes
      — Recipes, an app at yourname.yaks.app/recipes/

The listing includes the app's title, because the slug is often not the name the
person uses for the app, and a model selects commands by their words. Its
`structuredContent` is
`{commands: [{at, name, title, description, readOnly, input, view?}]}` — `at` is
the app in the form `command` accepts, and `input` is the command's own JSON
Schema.

A deploy does not change any caller's tool list, and neither does joining a
space or trashing an app. Only a platform release changes the tool list, and
then an MCP client that has already listed the tools is told to list them again
(`notifications/tools/list_changed`, and a line on its next reply). A deploy can
change the view pages that commands' answers are rendered in; those are MCP
resources, and `notifications/resources/list_changed` announces the change.

## Entry keys

An entry has `"tool": true`, a `description`, its arguments (`input` and
`required`), exactly one action (`apply` or `query`), an optional `view`, and an
optional `"model": true`. A deploy refuses any other key by name instead of
ignoring it, so a mistyped key is an error at deploy time rather than a command
that does only part of what was intended.

### description

Required. The description is the only information a model has about the command,
and the model selects the command by it, so write the sentence the person would
say, not a description of the row: "Log a run for the club leaderboard", never
"Writes a jog component". Copy the style of the platform's own tools, which say
what the command does and then when to use it: "Every run since a date, newest
first. Ask for it when someone wants the board." The platform appends the app's
title and address; do not include them.

### input and required

`input` is an object of argument names to JSON Schemas, one per argument, the
way a component declares its properties: `{ "type": "string" }`,
`{ "type": "number" }`, `{ "type": "boolean" }`, and any other JSON Schema
keyword, such as a `format`, an `enum`, or a `description` the model reads. An
argument name is `[a-z][a-z0-9_]{0,39}`, like a command's, and a command with no
arguments leaves `input` out. Together they are the JSON Schema `commands`
prints and `command` checks `args` against.

`required` lists the arguments a caller must send. An argument it does not list
may be left out of a call, and then everything that uses its variable is left
out too: a key whose value is only that variable is not written, a string the
variable is spliced into is not written either, and a query clause that names it
is dropped from the filter, so a `find` with nothing to filter by reads
everything. `commands` marks an optional argument with a `?`.

An argument arrives as whatever the model sent and is converted to the type its
schema declares: `"5"` for a `number` becomes `5`, `"true"` for a `boolean`
becomes `true`. A value that cannot be converted is refused by name, and nothing
is written:

    miles is required
    miles is a number
    ready is true or false
    who is text                    ← an object where a string was declared

An undeclared argument is dropped, not refused: it binds no variable, and
refusing it would only make the model retry with another guess.

### The action: `apply` or `query`

An entry has exactly one of `apply` or `query`. A deploy refuses an entry with
neither or both:

    log_run does one thing: apply (a bundle to write) or query (a filter
    line to read)

## Template variables

`$arg` anywhere in the template — a key's value, a query string, an element of a
list — is a **variable**, the same `$var` syntax that writes to the store and
the query grammar use. An argument of that name binds it, and the variable is
replaced by that argument's value.

**A string that is nothing but a bound variable keeps the argument's own type.**
So `"miles": "$miles"` writes the number `5`, not the string `"5"`, and
`"ready": "$ready"` writes a boolean. This is the form to use for every property
that is not text.

**A variable inside a longer string is spliced in as text**, so a `title` of
"Run by $who" writes `Run by Ada`. In a `query`, a spliced value is
percent-encoded — a filter is written as a query string, and a title with an `&`
in it would otherwise read as the start of the next filter. `$$` is a literal
dollar sign.

**A variable that no argument binds is an alias**, as `$run` is in any write to
the store: the store creates a new entity in its place, and every other `$run`
in the same call refers to that entity. Whether a variable is an argument or an
alias depends on whether an argument of that name was sent.

A variable that names neither an argument nor an entity the template writes is a
typo, and a deploy refuses it:

    log_run: $when names no input and no entity here — declare it in
    log_run.input

## The `apply` action

`apply` is an entity bundle — one entity and the components written onto it — or
a list of them: exactly what `apply()` accepts on a page. A `$alias` creates a
new entity, and the answer reports the eid it was given. This command creates a
new entity on every call:

    "log_run": {
      "tool": true,
      "description": "Log a run for the club leaderboard",
      "input": { "who":   { "type": "string" },
                 "miles": { "type": "number" } },
      "required": ["who", "miles"],
      "apply": { "entity": { "eid": "$run" },
                 "doc": { "title": "Run by $who" },
                 "jog": { "who": "$who", "miles": "$miles" } } }

Two entities in one call, the second pointing at the first by its alias:

    "log_with_note": {
      "tool": true,
      "description": "Log a run and a note about how it felt",
      "input": { "who":   { "type": "string" },
                 "miles": { "type": "number" },
                 "note":  { "type": "string" } },
      "required": ["who", "miles", "note"],
      "apply": [
        { "entity": { "eid": "$run" },
          "jog": { "who": "$who", "miles": "$miles" } },
        { "entity": { "eid": "$said" },
          "doc": { "body": "$note" },
          "comment": { "target": "$run" } } ] }

Aliases and arguments share one namespace, so an alias and an argument cannot
have the same name: the alias here is `$said` because `$note` is already an
argument. For the same reason an eid can be an argument: put a bound variable
where the eid goes, and the bundle patches the entity that argument names and
leaves its other components unchanged. A bundle's own keys (`entity`, `edges`,
`tombstone`, `was`) work in a template beside the components, so a command can
add an edge or delete an entity:

    "drop_run": {
      "tool": true,
      "description": "Delete a run somebody logged by mistake",
      "input": { "run": { "type": "string" } },
      "required": ["run"],
      "apply": { "entity": { "eid": "$run" }, "tombstone": {} } }

The answer says what was written and carries the ids in `structuredContent`, so
the agent's next call, or a view's redraw, can read the entity back by the eid
this call created:

    log_run: wrote 1 entity in yourname/runs: $run=4f3c…
    { "entities": ["4f3c…"], "aliases": { "$run": "4f3c…" } }

## The `query` action

`query` is a filter written as a query string, the same grammar boards and
`query()` use, and it returns the same listing a page gets:

    "board": {
      "tool": true,
      "description": "The leaderboard: every run, with who logged it",
      "query": ".jog&.created" },
    "since": {
      "tool": true,
      "description": "Runs logged since a date, or every run",
      "input": { "since": { "type": "string",
                            "description": "a date, like 2026-09-01" } },
      "query": ".jog&?doc&.created.at>=$since" },
    "longest": {
      "tool": true,
      "description": "Runs over a distance",
      "input": { "miles": { "type": "number" } },
      "required": ["miles"],
      "query": ".jog.miles>=$miles&?doc&limit=20" }

A row carries only the components its filter names, so name every component the
answer must show: `.jog` alone returns no titles, and `&?doc` adds the `doc`.
`.created` gives the board its bylines: a reference to a person the store knows
reads back as `{eid, name}`, so the answer names who ran instead of "someone".
The answer gives the row count and the rows:

    leaderboard: 12 rows in yourname/runs
    { "rows": [ { "kind": "jog", "entity": { "eid": "4f3c…" },
                  "jog": { "who": "Ada", "miles": 5 },
                  "created": { "at": "2026-09-01T…",
                               "by": { "eid": "…", "name": "Ada" } } } ] }

## Templates and the security model

No code in a tool entry runs. Filling in the template produces exactly the
request body that a page's own `apply` or `query` would send, and that request
goes to the same `/api/` endpoints the page uses, **as the person calling the
command**. Three rules follow from that, and they are the whole security model:

- **The app's `access` decides.** A `public` app accepts a write from an owner
  or editor of the space; an `open` one from anyone who can reach it. A viewer
  running a write command gets the same message the page would have shown them:
  "you can read this app but not change it — its owner can make you an editor".
- **`created.by` names them**, so `.created` on the rows a command wrote reports
  who ran it.
- **A command grants no access beyond what the caller has on the page.**

Code that calls an outside API, uses a secret or computes an answer belongs in a
`worker.js`, not in a command.

## What a deploy refuses

`app_files` writes the file without reading it; `app_deploy` reads it.
`app_deploy` checks every tool entry before installing anything and **reports
every problem in one message**, so an agent can fix them all at once instead of
one per deploy:

    vocab.json: bad: screen — a tool says tool, description, input, required,
    apply, query, view, model; bad: $who names no input and no entity here —
    declare it in bad.input

When the deploy refuses, nothing is installed, and the app's existing commands
keep working unchanged. It checks:

- the command name and every argument name (`a-z`, `0-9`, `_`, starting with a
  letter)
- an entry has no keys but those eight, a `description` that is a sentence, an
  `input` whose every argument is a JSON Schema, and a `required` naming only
  its inputs
- exactly one action; `query` a string, `apply` an object or a list of them
- every `$var` names a declared input, or an entity the template creates
- every component an `apply` names is one the platform provides or this app's
  `vocab.json` declares — the refusal names the component that is not declared
  and tells you to declare it in `vocab.json` or use one of the platform's own
- `view` is a page in this app's own files: relative, no `..`, ending `.html`

The `view` check reads the app's files, not `vocab.json`, so a missing page is
caught at deploy, and the message says what to do:

    vocab.json: gone.html — a view names a page in this app's own files;
    deploy the page beside index.html

Components are installed before commands, so a command may write a component
declared in the same deploy.

## Commands the app's models may call (`"model": true`)

`"model": true` offers a command to the app's own models as a tool: when a
transcript in the app's store asks a model for a turn (see
[AI Models](/docs/models)), the commands marked this way are the tools it is
offered, and no others. The model's call runs as the person who asked for the
turn, limited to what that person could write on the page.

    "set_mood": { "tool": true, "model": true,
                  "description": "Say how the smith feels",
                  "input": { "feeling": { "type": "string" } },
                  "apply": { "entity": { "eid": "$m" },
                             "mood": { "feeling": "$feeling",
                                       "of": "$session" } } }

In such a command, `$session` is the transcript the turn belongs to: here, the
smith whose mood it is. No argument can bind it, so a model cannot be persuaded
to name another transcript, and a command that uses `$session` runs only in a
model's turn; a call to it through `command` is refused. Every row such a call
writes has the transcript in `created.via`, so a page can tell rows the smith's
turn wrote from rows of the same shape that a visitor wrote.

## Views: a page that renders a command's answer

An entry may name a `view`: a page in the app's own files that the person's
agent renders the answer in, instead of returning it as text. Write it like any
other page, deploy it with the app's other files, and name it beside the action:

    "leaderboard": { "tool": true,
                     "description": "Every run so far",
                     "query": ".jog&.created",
                     "view": "leaderboard.html" }

Through the MCP connector the page is a resource at `ui://<space>/<app>/<file>`,
served as `text/html;profile=mcp-app`, and the `commands` listing gives it as
that command's `view`. The link is in the listing rather than in a tool's
`_meta`, because the app has no MCP tool of its own to attach it to. This is the
one limitation of the fixed tool list: an MCP client that renders a widget from
the tool it called finds no widget link in the answer, so the agent fetches the
page and shows it, instead of the client rendering it automatically. Only a page
that a command names can be read through the connector: the app's other files
are served on the web only, and a request for one returns `no resource`.

**Relative URLs work.** The connector prepends a `<base href>` pointing at the
app's own address — the same tag the app's pages are served with on the web —
and names that address in the resource's CSP metadata, so `./style.css` and an
image beside `index.html` load. A page carrying a `<base>` of its own keeps it.

**The frame cannot read `./api/` itself.** It is rendered off-origin with no
session cookie, so a `fetch` to the app's `/api/` endpoints arrives
unauthenticated. The view gets its data from the command's answer instead, and
to redraw it sends a `tools/call` of `command` back through the MCP client,
which does identify the caller.

### The view protocol, step by step

1. The page sends `ui/initialize` as a request — with an `id`, so a reply comes
   back; its `result.hostContext.styles.variables` holds the MCP client's own
   theme, where it provides one.
2. Then `ui/notifications/initialized`.
3. The answer arrives as `ui/notifications/tool-result`, and the params'
   `structuredContent` is what the action returned — `{rows: […]}` for a
   `query`, `{entities, aliases}` for an `apply`. An MCP client that forwards
   only the text sends `content` instead, so fall back to reading that.
4. The page reports its height with `ui/notifications/size-changed`, whenever it
   changes.

Everything is `window.parent.postMessage` with a JSON-RPC envelope, and
`e.data.id` matches a reply to the request that asked for it.

### Complete view example

    <!doctype html>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="./style.css" />
    <ol id="board"></ol>
    <button id="today">today only</button>
    <script>
      let call = (method, params) =>
        parent.postMessage({ jsonrpc: '2.0', method, params }, '*')

      let asked = 1
      let request = (method, params) =>
        new Promise((resolve) => {
          let id = asked++
          addEventListener('message', function heard(e) {
            if (!e.data || e.data.id !== id) return
            removeEventListener('message', heard)
            resolve(e.data)
          })
          parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*')
        })

      let sized = () =>
        call('ui/notifications/size-changed', {
          width: document.body.scrollWidth,
          height: document.body.scrollHeight,
        })

      let draw = (data) => {
        board.replaceChildren(...((data || {}).rows || []).map((r) => {
          let li = document.createElement('li')
          li.textContent = `${r.jog.who} — ${r.jog.miles} miles` +
            (r.created ? ` · logged by ${r.created.by.name}` : '')
          return li
        }))
      }

      addEventListener('message', (e) => {
        let msg = e.data
        if (!msg || msg.method != 'ui/notifications/tool-result') return
        draw((msg.params || {}).structuredContent)
      })

      // The redraw: this app's own command, called back through the client.
      today.addEventListener('click', async () => {
        let { result } = await request('tools/call', {
          name: 'command',
          arguments: {
            name: 'since',
            args: { since: new Date().toISOString().slice(0, 10) },
          },
        })
        if (result && !result.isError) draw(result.structuredContent)
      })

      request('ui/initialize', { protocolVersion: '2026-01-26' }).then(() => {
        call('ui/notifications/initialized', {})
        sized()
      })

      new ResizeObserver(sized).observe(document.body)
    </script>

Design the view for a narrow frame: it is rendered inside a conversation.

## Complete vocab.json example

The run club app's component and its commands, in one file:

    { "$defs": {
        "jog": { "properties": {
          "who":   { "type": "string" },
          "miles": { "type": "number" },
          "at":    { "type": "string", "format": "date-time" } } },
        "log_run": {
          "tool": true,
          "description": "Log a run for the club leaderboard",
          "input": { "who":   { "type": "string" },
                     "miles": { "type": "number" },
                     "at":    { "type": "string", "format": "date-time" } },
          "required": ["who", "miles"],
          "apply": { "entity": { "eid": "$run" },
                     "doc": { "title": "Run by $who" },
                     "jog": { "who": "$who", "miles": "$miles",
                              "at": "$at" } } },
        "leaderboard": {
          "tool": true,
          "description": "Every run logged so far, with who logged it",
          "query": ".jog&.created",
          "view": "leaderboard.html" },
        "since": {
          "tool": true,
          "description": "Runs logged since a date",
          "input": { "since": { "type": "string",
                                "description": "a date, like 2026-09-01" } },
          "required": ["since"],
          "query": ".jog&.created&.created.at>=$since",
          "view": "leaderboard.html" } } }

Two commands share one view: the connector lists the page once, and each
command's answer is rendered in it. Deploy this file beside `index.html` and
`leaderboard.html`, and the club has three commands that the person's agent can
call in any conversation, with the same access the person has on the page.

The whole guide, covering everything else an app can do, is at
<https://yaks.app/docs.md>.
