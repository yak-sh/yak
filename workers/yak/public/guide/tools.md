# Tools of your own

An app's pages need somebody looking at them. Its tools do not. A `tools.json`
beside `index.html` gives the person's agent verbs of the app's own — log a run,
read the leaderboard, close a shift — with nothing open. This page is that file:
what an entry says, how `{{arg}}` holes are filled and typed, the two acts, what
a deploy refuses, and the page a tool's answer draws itself in.

## Why an app carries tools at all

The graph tools (`graph_apply`, `graph_query`) can already write anything. What
they cannot do is say what this app MEANS. A declared tool is the app's own
vocabulary at the agent's door: one sentence the model chooses by, typed
arguments, and a template you wrote once so nobody has to remember that a run is
`jog{who, miles}` on a fresh entity. It is listed for everyone else in the space
too, so an app for four people is four people's verb.

## The file

`tools.json` sits at the app's root, beside `vocab.json`, and the same
`app_deploy` hands it over. An object of entries, keyed by name:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number" },
        "apply": { "entity": { "eid": "$run" },
                   "jog": { "who": "{{who}}", "miles": "{{miles}}" } } } }

The manifest is replaced whole on every deploy — a declaration holds no rows, so
there is nothing to migrate; delete `tools.json` and the next deploy leaves the
app with no tools at all. It is the app's INSIDE, not one of its pages:
`GET /<app>/tools.json` is a 404 on the web, the same as `vocab.json` and
`worker.js`, and a member reads it back with `app_files`.

## The name, and who may call it

At the connector a tool is `<app>__<tool>` — `runs__log_run`. An app slug
carries no underscore and a tool name is `[a-z][a-z0-9_]{0,39}`, so the first
`__` is the seam and no app's word can collide with another's or with the
platform's own tools.

The deploy answers with the names it planted:

    deployed jeff/runs v3: https://jeff.yaks.app/runs/
    tools: runs__log_run, runs__leaderboard, runs__since

**Who sees it is who can reach the app**: every app in every space the caller
belongs to. A `public` or `open` app in a space they are NOT in is reachable on
the web and not here — a bare `<app>__<tool>` has no space in it to resolve
against. Two apps in two of their spaces CAN share a slug; the first answers,
and a call for the other refuses with the spaces named:

    runs is an app in club and jeff — rename one, or use graph_apply with
    the space named

The listing carries the app's title, because a slug is not what the person
called it and a model chooses by words:

    name:  runs__log_run     title: Run club: log_run
    description: Log a run for the club leaderboard — Run club, an app at
                 jeff.yaks.app/runs/

A deploy that MOVES that list tells every member of the space so, on their own
MCP stream (`notifications/tools/list_changed`) — a client that listed once
lists again. A deploy that changes no tool says nothing.

## The four parts of an entry

`description`, `input`, exactly one act (`apply` or `query`), and an optional
`view`. Any other key is refused by name rather than ignored, so a misspelling
is a sentence at deploy and not a tool that quietly does half of what was meant.

### description

Required, and the whole of what a model has to go on. It is what the tool is
CHOSEN by, so write the sentence the person would say, not the shape of the row:
"Log a run for the club leaderboard", never "Writes a jog component". The house
style for the platform's own tools is the one to copy — say what it does, then
when to reach for it: "Every run since a date, newest first. Ask for it when
someone wants the board." The app's title and address are appended for you; do
not write them in yourself.

### input

An object of argument names to types. Five types, the same words a component's
columns use: `text`, `number`, `bool`, `time`, `url`. An argument name is
`[a-z][a-z0-9_]{0,39}`, like a tool's, and `"input": {}` is a tool that takes
nothing. They become JSON Schema for the host: `number` is a number, `bool` a
boolean, and `text`, `time` and `url` are strings — the last two carrying a
description of the shape wanted, so a `time` argument says it wants something
like 2026-09-01 or 2026-09-01T10:00:00Z.

**Every declared argument is required.** There are no optional arguments and no
defaults: a hole with nothing to fill it would splice the word `undefined` into
your template. If something is genuinely optional, that is two tools.

An argument arrives as whatever the model sent and is read under the type it was
declared as: `"5"` for a `number` becomes `5`, `"true"` for a `bool` becomes
`true`. What cannot is refused by name, and nothing is written:

    miles is required
    miles is a number
    ready is true or false
    who is text                    ← an object where text was declared

An argument nobody declared is dropped rather than refused — it can fill no
hole, and refusing it would only teach the model to guess again.

### The act

Exactly one of `apply` or `query`. Neither, or both, is a refusal at deploy:

    log_run does one thing: apply (a bundle to write) or query (a filter
    line to read)

## Holes

`{{arg}}` anywhere in the template — a key's value, a filter line, an element of
a list — is filled from the call's arguments.

**A string that is nothing but a hole keeps the argument's own type.** So
`"miles": "{{miles}}"` writes the number `5`, not the string `"5"`, and
`"ready": "{{ready}}"` writes a boolean. This is the form to use for every
column that is not text.

**A hole inside a sentence is spliced in as text**, so a `title` of "Run by
{{who}}" writes `Run by Ada`. In a `query`, a spliced value is percent-encoded —
a filter line is a query string, and a title with an `&` in it would otherwise
read as the start of the next filter.

A hole naming an argument the `input` never declared is refused at deploy:

    log_run: {{when}} names no input — declare it in log_run.input

## The apply act

`apply` is an entity bundle, or a list of them — exactly what `apply()` takes on
the page; a `$alias` mints a new entity, and the answer says what eid it became.
A new entity every call:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number" },
        "apply": { "entity": { "eid": "$run" },
                   "doc": { "title": "Run by {{who}}" },
                   "jog": { "who": "{{who}}", "miles": "{{miles}}" } } } }

Two entities in one call, the second pointing at the first by its alias:

    { "log_with_note": {
        "description": "Log a run and a note about how it felt",
        "input": { "who": "text", "miles": "number", "note": "text" },
        "apply": [
          { "entity": { "eid": "$run" },
            "jog": { "who": "{{who}}", "miles": "{{miles}}" } },
          { "entity": { "eid": "$note" },
            "doc": { "body": "{{note}}" },
            "comment": { "target": "$run" } } ] } }

An eid can be an argument, so a tool may change a row somebody names rather than
mint one: put `{{run}}` where the eid goes and the bundle patches the columns it
says, leaving the rest. The wire's own words work in a template beside the
components — `entity`, `dependency`, `tombstone`, `was` — so a tool can draw an
edge or delete a row:

    { "drop_run": {
        "description": "Delete a run somebody logged by mistake",
        "input": { "run": "text" },
        "apply": { "entity": { "eid": "{{run}}" }, "tombstone": {} } } }

The answer names what was written and carries the ids as `structuredContent`, so
the agent's next call — or a view's redraw — reads the row back by the eid this
one minted:

    runs__log_run: wrote 1 entity in jeff/runs: $run=4f3c…
    { "entities": ["4f3c…"], "aliases": { "$run": "4f3c…" } }

## The query act

`query` is a filter line, the same grammar boards and `query()` speak, answered
as the same listing a page gets:

    { "board": {
        "description": "The leaderboard: every run, with who logged it",
        "input": {},
        "query": ".jog!&.created!" },
      "since": {
        "description": "Runs logged since a date",
        "input": { "since": "time" },
        "query": ".jog!&.doc?&.created.at>={{since}}" },
      "longest": {
        "description": "Runs over a distance",
        "input": { "miles": "number" },
        "query": ".jog.miles>={{miles}}&.doc?&limit=20" } }

A row carries only the components its filter NAMES, so name what the answer must
show — `.jog!` alone answers no titles, and `&.doc?` asks for one beside it.
`.created!` is how the board gets its bylines: a reference to somebody the store
knows answers `{eid, name}`, so the answer says who ran, not "someone". The
answer counts and carries the rows:

    runs__leaderboard: 12 rows in jeff/runs
    { "rows": [ { "kind": "jog", "entity": { "eid": "4f3c…", "num": 12 },
                  "jog": { "who": "Ada", "miles": 5 },
                  "created": { "at": "2026-09-01T…",
                               "by": { "eid": "…", "name": "Ada" } } } ] }

## A tool is a template, never code

Nothing in a manifest runs. Filling a template makes exactly the body a page's
own `apply` or `query` would send, and the call goes through the app's ordinary
doors **as the person calling it**. Three things follow — the whole of the
security model:

- **The app's `access` decides.** A `public` app takes a write from an owner or
  editor of the space; an `open` one from anyone who can reach it. A viewer
  calling a write tool reads the sentence the page would have shown them: "you
  can read this app but not change it — its owner can make you an editor".
- **`created.by` names them**, so `.created!` on the rows a tool wrote says who
  called it.
- **Nobody gets more through a tool than they have on the page.**

Code that DOES something — an outside API, a secret, a computed answer — is a
`worker.js`, not a tool.

## What a deploy refuses

`app_files` writes the manifest without reading it; `app_deploy` reads it. The
whole file is checked before anything is planted, and **every problem comes back
in one sentence** — an agent fixing one problem per deploy stops after the
second:

    tools.json: bad: screen — a tool says description, input, apply, query,
    view; bad: {{who}} names no input — declare it in bad.input

Nothing is planted when it refuses: the tools the app had keep answering exactly
as before. What it checks:

- the tool name and every argument name (`a-z`, `0-9`, `_`, from a letter)
- an entry is an object carrying no key but the five, with a `description` that
  is a sentence and an `input` whose every type is one of the five
- exactly one act; `query` a string, `apply` an object or a list of them
- every `{{hole}}` names a declared input
- every component an `apply` names is one the platform says or this app's
  `vocab.json` declares — "jogg is not a component — declare it in vocab.json,
  or use one the platform already says"
- `view` is a page in this app's own files: relative, no `..`, ending `.html`

That last one is checked against the app's FILES, not the manifest, so the
deploy is where it is caught, and the sentence says what to do:

    tools.json: gone.html — a view names a page in this app's own files;
    deploy the page beside index.html

Components are planted before tools, so a tool may write a word declared by this
very release.

## The view: a page the answer draws itself in

An entry may name a `view` — a page in the app's own files that the person's
agent RENDERS the answer in instead of reading it out. Write it like any other
page, deploy it with the rest, name it beside the act:

    "leaderboard": { "description": "Every run so far",
                     "input": {},
                     "query": ".jog!&.created!",
                     "view": "leaderboard.html" }

At the door the page becomes a resource at `ui://<space>/<app>/<file>`, served
as `text/html;profile=mcp-app`, and the tool links it with
`_meta.ui.resourceUri`. Its visibility is `['model', 'app']` — `app` is what
lets the page call the tool BACK, which is how a button or a date picker
redraws, and it grants nothing the app's own page does not already have. Only a
page a tool NAMED is readable this way: the app's other files are the web's
business, not this door's, and asking for one is `no resource`.

**Relative URLs work.** The door prepends a `<base href>` at the app's own
address — the same tag the app door gives every page it serves — and names that
address in the resource's CSP metadata, so `./style.css` and an image beside
`index.html` load. A page carrying a `<base>` of its own keeps it.

**The frame cannot read `./api/` itself.** It is rendered off-origin with no
session cookie on it, so a `fetch` at the app's doors is nobody. Its data
arrives in the tool's answer; a redraw is a `tools/call` back through the host,
which does carry who is asking.

### The protocol, in the order it happens

1. The page sends `ui/initialize` as a REQUEST — with an `id`, so a reply comes
   back; its `result.hostContext.styles.variables` holds the host's own theme,
   where it lends one.
2. Then `ui/notifications/initialized`.
3. The answer arrives as `ui/notifications/tool-result`, and the params'
   `structuredContent` is what the act answered — `{rows: […]}` for a `query`,
   `{entities, aliases}` for an `apply`. A host that forwards only the text
   sends `content` instead, so fall back to reading that.
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

      // The redraw: this app's own tool, called back through the host.
      today.addEventListener('click', async () => {
        let { result } = await request('tools/call', {
          name: 'runs__since',
          arguments: { since: new Date().toISOString().slice(0, 10) },
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

    { "jog": { "who": "text", "miles": "number", "at": "time" } }

`tools.json`:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number", "at": "time" },
        "apply": { "entity": { "eid": "$run" },
                   "doc": { "title": "Run by {{who}}" },
                   "jog": { "who": "{{who}}", "miles": "{{miles}}",
                            "at": "{{at}}" } } },
      "leaderboard": {
        "description": "Every run logged so far, with who logged it",
        "input": {},
        "query": ".jog!&.created!",
        "view": "leaderboard.html" },
      "since": {
        "description": "Runs logged since a date",
        "input": { "since": "time" },
        "query": ".jog!&.created!&.created.at>={{since}}",
        "view": "leaderboard.html" } }

Two tools share one view — the door lists the page once, and each draws its own
answer in it. Deploy that beside `index.html` and `leaderboard.html`, and the
club has three verbs anywhere the person talks to their agent, doing what they
could do on the page and no more.

The whole guide, everything else an app can do, is at
<https://yaks.app/guide.md>.
