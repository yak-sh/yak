---
name: tools
description: "Commands of your own (yaks.app). tools.json, so the person's agent can act on an app with no page open: an entry's description, its input types and $var bindings, the apply and query actions, what a deploy refuses, the page an answer is drawn in, and how the commands and command tools carry them."
---

# Commands of your own

An app's pages need somebody looking at them. Its commands do not. A
`tools.json` (or `tools.yml`) beside `index.html` gives the person's agent
commands of the app's own — log a run, read the leaderboard, close a shift —
with nothing open. This page is that file: what an entry declares, how `$var`
variables are bound and typed, the two actions, what a deploy refuses, the page
a command's answer is drawn in, and how the `commands` and `command` tools carry
all of it.

## Why an app carries commands at all

The graph tools (`graph_apply`, `graph_query`) can already write anything. What
they cannot do is describe what this app is for. A declared command gives the
agent the app's own vocabulary: one sentence the model chooses by, typed
arguments, and a template you wrote once so nobody has to remember that a run is
`jog{who, miles}` on a fresh entity. It is listed for everyone else in the space
too, so an app for four people is a command four people can use.

A new capability is a new component, not a new command. `graph_apply` already
writes anything the vocabulary declares, so something an app needs to keep, a
`rating`, a `loan`, a `shift`, is a line in its `vocab.json`, discoverable by
everyone through `graph_schema` the moment it deploys. Reach for a command only
when the app needs a verb that someone else's agent can call. Every command is
one more name anyone reading `commands` has to choose between.

## Every kind you declare is two commands already

You get the first two for nothing. Every component an app's `vocab.json`
declares is a kind of thing the app is about, and `app_deploy` gives each one a
command for adding one and a command for finding one again:

    vocab.json  { "$defs": {
                    "recipe": { "properties": {
                      "serves":  { "type": "number" },
                      "cuisine": { "type": "string" } } } } }

    →  add_recipe    title, body, alias, serves, cuisine
       find_recipe   words, serves, cuisine, limit

`add` creates an entity with that component on it, a `doc` for the title and
body, and an `alias` — a name the row answers to, so a later call reaches it
without having kept the eid. Only the `title` is required; a column nobody names
is a column nobody writes. `find` builds a query string over the same columns:
`words` is a full-text search over the title and body, each column is an
equality test, and every clause whose argument you leave out is left out of the
query — so `find` with no arguments returns everything of that kind.

**This is how an app is found again.** The person who asked for a recipe box in
one conversation says "add this recipe" in the next one, to an agent that has
never seen the app. `commands` is the one place every agent looks for what the
yaks apps can do, so the app is listed there whether or not anybody wrote a
`tools.json`.

Three ways to change that:

- **Opt out** — `"tools": false` at the top of `vocab.json`, beside `$defs`. The
  app declares its components and gets no generated commands at all.
- **Mark one as not a kind** — `"kind": false` on that component. A mark a row
  carries rather than a thing somebody adds — `starred`, `paid` — is nobody's to
  add, so it gets no commands while the rest of the file keeps its own.
- **Override** — declare `add_recipe` or `find_recipe` in `tools.json` yourself.
  Your entry wins whole: your sentence, your arguments, your template. A
  hand-written command describes what the app is for; a generated one only
  describes what it stores.

A deploy regenerates them from `vocab.json` as it reads at that moment, so a
column added to a kind is an argument added to its two commands.

## The file

`tools.json` sits at the app's root, beside `vocab.json`, and `app_deploy` is
what puts it into service. It is an object of entries, keyed by command name:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number" },
        "apply": { "entity": { "eid": "$run" },
                   "jog": { "who": "$who", "miles": "$miles" } } } }

The file is replaced whole on every deploy — a declaration holds no rows, so
there is nothing to migrate; delete `tools.json` and the next deploy leaves the
app with no commands at all. It is part of the app's source, not one of its
pages: `GET /<app>/tools.json` is a 404 on the web, the same as `vocab.json` and
`worker.js`, and a member reads it back with `app_files`.

## The name, and who may call it

A command's name is its whole name — `log_run`, not `runs__log_run`. It is not
an MCP tool and never appears in the connector's tool list. Two fixed MCP tools
carry every app's commands: **`commands`** lists what there is and **`command`**
runs one, with the app named beside the command rather than spliced into its
name.

    command { name: 'log_run', args: { who: 'Ada', miles: 5 } }

`args` is the command's own arguments, exactly as `commands` names them. `app`
goes beside them only where two apps you can reach have a command of the same
name.

**The tool list has to be fixed.** A directory such as OpenAI's snapshots
`tools/list` the day a connector is submitted and serves that snapshot forever —
only `tools/call` ever reaches the live server
(<https://developers.openai.com/plugins/deploy/app-review>). So this connector
lists the same names, in the same order, for every caller, signed in or not, and
a name that moved with what somebody deployed this morning could never be in
that snapshot. Commands are how an app's own actions reach an agent through a
tool list that cannot change.

The deploy reports the command names it registered:

    deployed yourname/runs v3: https://yourname.yaks.app/runs/
    commands: log_run, leaderboard, since

**Who sees them is who can reach the app**: every app in every space the caller
belongs to. A `public` or `open` app in a space they do not belong to is
reachable on the web but not by a command — a command names its app by slug, and
there is no space to resolve that slug against. Two apps in two of their spaces
can have a command of the same name; both are listed, and a call that names
neither app is refused, listing the candidates:

    log_run is a command of club/runs and yourname/runs — say which app

A name nobody has is refused with a list of the commands that do exist, since a
command list is a person's own and no model can have memorized it:

    no command add_run — your apps offer yourname/runs: log_run, leaderboard,
    since. commands lists them with their arguments.

`commands` groups them by app and lists each one's arguments the way `command`
accepts them, with a `?` on an optional argument. Its `app` argument — a slug,
or `<space>/<app>` where two spaces both have an app of that name — narrows it
to a single app; leave it out for everything you can reach:

    ## yourname/runs
    log_run(who, miles) — Log a run for the club leaderboard — Run club, an
      app at yourname.yaks.app/runs/

    ## yourname/recipes
    add_recipe(title, body?, alias?, serves?) — Add a recipe to yourname/recipes
      — Recipes, an app at yourname.yaks.app/recipes/

The listing carries the app's title, because a slug is not what the person
called it and a model chooses by words. Its `structuredContent` is
`{commands: [{at, name, title, description, readOnly, input, view?}]}` — `at` is
the app in the form `command` accepts, and `input` is the command's own JSON
Schema.

A deploy no longer changes anybody's tool list, and neither does joining a space
or trashing an app: the tools are the same tools they always were. Only a
platform release changes it, and then an MCP client that listed once is told to
list again (`notifications/tools/list_changed`, and a line on its next reply).
What a deploy does change is the pages a command's answer is drawn in — those
are MCP resources, and `notifications/resources/list_changed` announces it.

## The four parts of an entry

`description`, `input`, exactly one action (`apply` or `query`), and an optional
`view`. Any other key is refused by name rather than ignored, so a mistyped key
is an error at deploy time and not a command that quietly does half of what was
meant.

### description

Required, and the whole of what a model has to go on. It is what the model
chooses the command by, so write the sentence the person would say, not the
shape of the row: "Log a run for the club leaderboard", never "Writes a jog
component". The style of the platform's own tools is the one to copy — state
what it does, then when to reach for it: "Every run since a date, newest first.
Ask for it when someone wants the board." The app's title and address are
appended for you; do not write them in yourself.

### input

An object of argument names to types. Five types, the same ones a component's
columns use: `text`, `number`, `bool`, `time`, `url`. An argument name is
`[a-z][a-z0-9_]{0,39}`, like a command's, and `"input": {}` is a command with no
arguments. They become the JSON Schema `commands` prints and `command` fills
`args` from: `number` is a number, `bool` a boolean, and `text`, `time` and
`url` are strings — the last two carrying a description of the format wanted, so
a `time` argument asks for something like 2026-09-01 or 2026-09-01T10:00:00Z.

**Every declared argument is required.** There are no optional arguments and no
defaults: a variable with nothing to bind it would splice the word `undefined`
into your template. If something is genuinely optional, that is two commands.
(The two commands a kind gets are generated by the platform rather than written
by you, so those do let you leave an argument out — nothing breaks when a clause
is left out of a generated query, and `commands` marks them with a `?`.)

An argument arrives as whatever the model sent and is converted to the type it
was declared as: `"5"` for a `number` becomes `5`, `"true"` for a `bool` becomes
`true`. What cannot be converted is refused by name, and nothing is written:

    miles is required
    miles is a number
    ready is true or false
    who is text                    ← an object where text was declared

An argument nobody declared is dropped rather than refused — it binds no
variable, and refusing it would only teach the model to guess again.

### The action

Exactly one of `apply` or `query`. Neither, or both, is a refusal at deploy:

    log_run does one thing: apply (a bundle to write) or query (a filter
    line to read)

## Variables

`$arg` anywhere in the template — a key's value, a query string, an element of a
list — is a **variable**, the same `$var` that a write to the store and the
query grammar already use. An argument of that name binds it, and it becomes
that argument's value.

**A string that is nothing but a bound variable keeps the argument's own type.**
So `"miles": "$miles"` writes the number `5`, not the string `"5"`, and
`"ready": "$ready"` writes a boolean. This is the form to use for every column
that is not text.

**A variable inside a longer string is spliced in as text**, so a `title` of
"Run by $who" writes `Run by Ada`. In a `query`, a spliced value is
percent-encoded — a filter is written as a query string, and a title with an `&`
in it would otherwise read as the start of the next filter. `$$` is a literal
dollar sign.

**A variable nothing binds is an alias** — what `$run` has always meant in a
write to the store: the store creates an entity there, and every other `$run` in
the same call refers to that one. So one variable does both jobs, and which job
it does depends on whether an argument of that name arrived.

A variable that is neither an argument nor an entity the template writes is a
typo, refused at deploy:

    log_run: $when names no input and no entity — declare it in
    log_run.input

## The apply action

`apply` is an entity bundle — one entity and the components written onto it — or
a list of them, exactly what `apply()` accepts on the page. A `$alias` creates a
new entity, and the answer reports the eid it was given. A new entity on every
call:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number" },
        "apply": { "entity": { "eid": "$run" },
                   "doc": { "title": "Run by $who" },
                   "jog": { "who": "$who", "miles": "$miles" } } } }

Two entities in one call, the second pointing at the first by its alias:

    { "log_with_note": {
        "description": "Log a run and a note about how it felt",
        "input": { "who": "text", "miles": "number", "note": "text" },
        "apply": [
          { "entity": { "eid": "$run" },
            "jog": { "who": "$who", "miles": "$miles" } },
          { "entity": { "eid": "$said" },
            "doc": { "body": "$note" },
            "comment": { "target": "$run" } } ] } }

There is one namespace for variables, so an alias and an argument must not share
a name: `$said` is the alias here because `$note` is already the argument. An
eid can be an argument, exactly because of that — put a bound variable where the
eid goes and the bundle patches the row that argument names, leaving the rest of
it alone. A bundle's own keys work in a template beside the components —
`entity`, `edges`, `tombstone`, `was` — so a command can add an edge or delete a
row:

    { "drop_run": {
        "description": "Delete a run somebody logged by mistake",
        "input": { "run": "text" },
        "apply": { "entity": { "eid": "$run" }, "tombstone": {} } } }

The answer names what was written and carries the ids as `structuredContent`, so
the agent's next call — or a view's redraw — reads the row back by the eid this
one created:

    log_run: wrote 1 entity in yourname/runs: $run=4f3c…
    { "entities": ["4f3c…"], "aliases": { "$run": "4f3c…" } }

## The query action

`query` is a filter written as a query string, the same grammar boards and
`query()` use, and it returns the same listing a page gets:

    { "board": {
        "description": "The leaderboard: every run, with who logged it",
        "input": {},
        "query": ".jog!&.created!" },
      "since": {
        "description": "Runs logged since a date",
        "input": { "since": "time" },
        "query": ".jog!&.doc?&.created.at>=$since" },
      "longest": {
        "description": "Runs over a distance",
        "input": { "miles": "number" },
        "query": ".jog.miles>=$miles&.doc?&limit=20" } }

A row carries only the components its filter names, so name everything the
answer must show — `.jog!` alone returns no titles, and `&.doc?` asks for one
beside it. `.created!` is how the board gets its bylines: a reference to
somebody the store knows returns `{eid, name}`, so the answer names who ran
rather than "someone". The answer counts the rows and returns them:

    leaderboard: 12 rows in yourname/runs
    { "rows": [ { "kind": "jog", "entity": { "eid": "4f3c…", "num": 12 },
                  "jog": { "who": "Ada", "miles": 5 },
                  "created": { "at": "2026-09-01T…",
                               "by": { "eid": "…", "name": "Ada" } } } ] }

## A command is a template, never code

Nothing in a `tools.json` runs. Filling in a template produces exactly the
request body a page's own `apply` or `query` would send, and it goes to the same
`/api/` endpoints that page uses, **as the person calling the command**. Three
things follow — the whole of the security model:

- **The app's `access` decides.** A `public` app accepts a write from an owner
  or editor of the space; an `open` one from anyone who can reach it. A viewer
  running a write command gets the same message the page would have shown them:
  "you can read this app but not change it — its owner can make you an editor".
- **`created.by` names them**, so `.created!` on the rows a command wrote
  reports who ran it.
- **Nobody gets more through a command than they have on the page.**

Code that actually does something — calls an outside API, uses a secret,
computes an answer — belongs in a `worker.js`, not in a command.

## What a deploy refuses

`app_files` writes the file without reading it; `app_deploy` reads it. The whole
file is checked before anything is installed, and **every problem comes back in
one message** — an agent that could only fix one problem per deploy would give
up after the second:

    tools.json: bad: screen — a tool says description, input, apply, query,
    view; bad: $who names no input — declare it in bad.input

Nothing is installed when it refuses: the commands the app already had keep
working exactly as before. What it checks:

- the command name and every argument name (`a-z`, `0-9`, `_`, starting with a
  letter)
- an entry is an object with no keys but those five, a `description` that is a
  sentence, and an `input` whose every type is one of the five types
- exactly one action; `query` a string, `apply` an object or a list of them
- every `$var` names a declared input, or an entity the template creates
- every component an `apply` names is one the platform provides or this app's
  `vocab.json` declares — the refusal names the component that is not declared
  and tells you to declare it in `vocab.json` or use one of the platform's own
- `view` is a page in this app's own files: relative, no `..`, ending `.html`

That last one is checked against the app's files, not against `tools.json`, so
the deploy is where a missing page is caught, and the message tells you what to
do:

    tools.json: gone.html — a view names a page in this app's own files;
    deploy the page beside index.html

Components are installed before commands, so a command may write a component
declared by this very release.

## The view: a page the answer is drawn in

An entry may name a `view` — a page in the app's own files that the person's
agent renders the answer in instead of reading it out. Write it like any other
page, deploy it with the rest, and name it beside the action:

    "leaderboard": { "description": "Every run so far",
                     "input": {},
                     "query": ".jog!&.created!",
                     "view": "leaderboard.html" }

Over the MCP connector the page is a resource at `ui://<space>/<app>/<file>`,
served as `text/html;profile=mcp-app`, and the `commands` listing names it as
that command's `view`. The link is carried there rather than on a tool's
`_meta`, because this app has no MCP tool of its own to attach it to — which is
the one thing the fixed tool list costs: an MCP client that renders a widget
from the tool it called finds nothing to read in the answer, so the agent
fetches the page and shows it rather than the client drawing it by itself. Only
a page a command named is readable at all: the app's other files are served on
the web, not through the connector, and asking for one returns `no resource`.

**Relative URLs work.** The connector prepends a `<base href>` pointing at the
app's own address — the same tag the app's pages are served with on the web —
and names that address in the resource's CSP metadata, so `./style.css` and an
image beside `index.html` load. A page carrying a `<base>` of its own keeps it.

**The frame cannot read `./api/` itself.** It is rendered off-origin with no
session cookie, so a `fetch` to the app's `/api/` endpoints arrives as nobody.
Its data arrives in the command's answer instead, and to redraw it makes a
`tools/call` of `command` back through the MCP client, which does carry who is
asking.

### The protocol, in the order it happens

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

### A view, whole

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

Expect the frame to be narrow: a view is drawn inside a conversation.

## One app's whole tools.json

The run club, with the vocabulary it needs. `vocab.json`:

    { "$defs": {
        "jog": { "properties": {
          "who":   { "type": "string" },
          "miles": { "type": "number" },
          "at":    { "type": "string", "format": "date-time" } } } } }

`tools.json`:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number", "at": "time" },
        "apply": { "entity": { "eid": "$run" },
                   "doc": { "title": "Run by $who" },
                   "jog": { "who": "$who", "miles": "$miles",
                            "at": "$at" } } },
      "leaderboard": {
        "description": "Every run logged so far, with who logged it",
        "input": {},
        "query": ".jog!&.created!",
        "view": "leaderboard.html" },
      "since": {
        "description": "Runs logged since a date",
        "input": { "since": "time" },
        "query": ".jog!&.created!&.created.at>=$since",
        "view": "leaderboard.html" } }

Two commands share one view — the connector lists the page once, and each draws
its own answer in it. Deploy that beside `index.html` and `leaderboard.html`,
and the club has three commands anywhere the person talks to their agent, doing
what they could do on the page and no more.

The whole guide, everything else an app can do, is at
<https://yaks.app/docs.md>.
