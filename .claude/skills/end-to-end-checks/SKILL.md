---
name: end-to-end-checks
description: >
  Use when checking a change by hand, against live or copied data, in a
  browser/terminal or at a phone's width, taking screenshots or proving UI,
  query, write and migration behavior. Proof runs in your process with
  compose(), kernel(), linkedom or TUI lay; no probe servers or Chrome. A
  live yaks.app page is driven in Cloudflare's browser with yak admin browse.
  Automated tests are testing.
---

# Proving a change end to end

A test says the code does what its author meant. An end-to-end check says what a
person meets: the page a request comes back with, the row a write leaves behind,
the screen a key press paints. Here it runs in the process that asks for it,
through the same doors a person's request goes through, over data you can break.

The box has four cores, and every agent working shares them. When about eight
agents each ran a probe server, its worker, a dozen Chrome processes and the
gates beside them, the load reached 11.7 and the owner stopped them all. His
words, 2026-10-23 (18bc9a78, M-132169):

> a handful of agents shouldn't bring the box to its knees. and we need to stop
> all this chrome testing locally; it's too heavy and most things don't need
> chrome.

> tests and benchmarks should be starting zero other processes

and, of a benchmark that would drive a separate server: "that's the heavyness
i'm talking about. never do that!"

There is no Chrome or Chromium on this box and there are no browser tests,
locally or in CI. Check page behavior with linkedom in Deno and terminal
behavior with @yaks/tui's `lay`, in process. Once a change is live, a page of
yaks.app is seen and driven in Cloudflare's browser, off the box ("A live page
in a browser" below).

He would rather recover than gate (M-37965). Run the tests of what changed, in
seconds, then land with `yak land`. Main's CI runs after the push and files a
bug when it goes red; nobody waits on it or a deploy. There is no pre-land gate.
A check on the box is light and aimed: the change's own path, through its door,
in your process.

## The doors, in your process

- **The box's server.** `compose(config, roles)` from @yaks/cli/host builds what
  `yak serve` listens with, without binding a port. A config naming @yaks/api
  has a `handler`: hand it a `Request` and it answers as the server would.
  Compose over `{db: ':memory:', plugins: [...]}` with the plugins your change
  touches, and `close()` it when done; packages/cli/host_test.ts does this
  throughout.
- **yaks.app.** `kernel()` in workers/yak/probe.ts is the kernel in memory this
  process shares, and `fresh()` a kernel of one test's own (`testing`). Its
  stores, doors and connector answer as the Worker's do.
- **A page.** The web app mounts on a linkedom document in a Deno runtime, not
  in a browser; packages/browse/host_testing.ts speaks for the server on the
  page's socket. Check what a person meets: the text that shows, what a
  dispatched click or key changes.
- **The terminal.** @yaks/tui's `lay` paints an element to lines without a tty
  (`pane` in packages/browse/tui/testing.ts). Browse and inspect mount the
  browser's own App through it, so a key press and the screen after it are
  checked the same way.
- **Data shaped like the owner's.** Read entities from the live graph
  (`graph_show`, `graph_query`) and apply them to your in-memory graph; reading
  the live graph costs nothing, and a write to it lands in his day. For the
  whole of the box's data, run `bin/copy-db .scratch/copy.db` in the
  background (about 5 minutes for 10 GB) and name the copy as a scratch config's
  `db`; the first writer that opens it brings it to the schema your code
  expects. Copy no other way: `cp` of a live file is torn by its writes, and a
  bare `sqlite3 .backup` never finishes.
- **Timing a read.** A measurement never changes the box for everyone else: no
  dropping the page cache (`/proc/sys/vm/drop_caches`), no sysctl or kernel
  setting, no heavy load aimed at the live servers. This container shares its
  kernel with the Proxmox host and every guest on it, so those reach all of
  them. For a cold read, time the first read of a fresh copy made with
  `bin/copy-db`.

A check worth keeping is a test (`testing`); a one-off is a script or a test you
don't land, and either way it runs in one process and leaves nothing running.

## What no longer runs here

- **Chrome.** A screen's behavior is checked on its document, as above. How it
  lays out, swipes and animates on a phone is seen live with `yak admin
  browse` once it lands; the owner's review arrives as comments on the task
  (`ui-building`).
- **A scratch `yak serve`, `yak work` or units of your own.** Each is a server
  that keeps running beside you, with a worker that outlives it. A change to how
  the box's units start, stop or hand over is checked through
  packages/cli/restart.ts's functions with their effects handed in, then by the
  next `yak restart`; one that breaks is fixed forward.
- **tmux driving a CLI against a probe.** The TUI's paint is checked with `lay`;
  the commands themselves through `compose()`.
- **docker.** A container image a Worker runs is measured where it runs, on
  Cloudflare, after it deploys, and the report says so.

There is no slow platform tier. Checks start no server, workerd or child
process and make no network call; test our decisions through the graph and its
generic effect interfaces. Files created by a check stay in its temporary
directory.

## Once it lands

Every commit on main deploys the yak worker through Workers Builds and runs CI
asynchronously. Work is done when its affected tests pass and it lands; no agent
waits for those background runs. `admin_deploys` as admin says what is live,
`admin_errors` what broke, and a new failure reaches the tracker when it happens
(M-37965). A live check of the platform runs in the agents' own space,
`checks` (checks.yaks.app), as its owner `checks@bot.yak.sh`, and never as Jeff.
It reads the rows the change wrote: a turn's `using{provider, model}` and
`cost{dollars}` (`conversation_read --lines`), spend rows, the entities it
changed. What a model says about itself is not evidence, so never ask it.

### Acting as checks

Every yaks.app tool is a `yak` command, and `--as checks` signs that call in
as checks@bot.yak.sh. The connection is already on this box, so there is no
sign-in step:

```sh
yak about --as checks                  # "You are signed in as checks <checks@bot.yak.sh>"
yak app_list --as checks               # the space's apps and how full it is
yak app_files app=roster space=checks op=list --as checks
yak operator_chat --space checks --as checks
```

A tool's own arguments are written `name=value`, and `name=@file` reads a
value from a file (JSON for an array such as `drafts`). Every call made with
`--as checks` on this box is one conversation, so drafts and other
per-conversation state carry from one call to the next.

The `mcp__…yaks_app__*` tools in an agent session are Jeff's claude.ai
connector, signed in as him, with no way to pick another account. A live check
never calls them: anything they write (`feedback` included) is written as Jeff,
lands in his conversation, Updates and task list, and a chat with his Operator
forks his conversation, where he sees it (one timing run left dozens of "ok"
probes in his). Reading through them is fine. Never
check in the `jeff` space or any person's, and never drive a person's Operator
to measure or exercise it.

`operator_chat` and `conversation_start`/`conversation_send` speak as an
outside agent (`entry.from`), in a fork under a task: never the person's own
words, so they cannot check what the person's own message does (answering a
decision, a note beside their words). For that, type into checks' own chat
page in the browser, as a person does (below), and read the rows with
`yak <tool> --as checks`.

`checks` is kept from the idle sweep and has a comped plan with no app cap.
Concurrent checks share the space, and an Operator build can keep working
between calls. Give every app a check creates a name and slug unique to that
run, and keep the app ID it returns. When the run ends, even if the check
fails, use `app_delete space=checks app=<id> --as checks` on only the apps
created by that run. This moves them to recoverable trash. Discard the drafts
the run opens (`op=discard draft=<id>`). A check that needs an account
with nothing in it runs `yak admin throwaway '<command>'`, which puts its spaces
in the trash once that command exits and so cuts off any Operator work still
running. The account and its data remain recoverable until the person chooses
permanent erasure through the confirmation page.

An Operator's model varies from run to run, so one run of a behavior proves little:
send the same kind of request three or more times and count. Comparing two
versions of the Operator takes dozens of runs an arm: 16 could not tell 82% from
88% (T-262). Deploys land while a batch runs, so read which code a run saw from
the run itself (`operator_read`: its session's `fixed{parts}` holds each tool
definition's size, and each tool answer's text is in its entry), not from the
clock. A script run in the background can find another `yak` first on its PATH;
name `~/.deno/bin/yak` in it. Acting as the owner is his to grant (M-31958).
The box's own server runs main after `yak restart`. The platform itself is
`yaks-app`.

### Texting and calling as checks

Two local numbers on yaks.app's Telnyx account are the agents' own. Text and
call only between them and the Operators' numbers; never a person's number.

| number         | role                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| +12694929622   | the checks person's phone: the number checks texts and calls from (`test-call.ts --from`), held by no space |
| +12692383446   | the `checks` space's own number (`number_status --space checks --as checks`): checks' Operator answers on it |

Send from +12694929622 with the Telnyx API (key: `op read 'op://Yak Shaving
LLC/telnyx API/credential'`), `POST /v2/messages` for one text, and read
what was sent and answered in `GET /v2/detail_records?filter[record_type]=messaging`.
A group text needs three local numbers: `POST /v2/messages/group_mms` to one
other number arrives as a one-to-one text, and carriers refuse a group that
includes a toll-free number such as yaks.app's own.

### Checking the public pages as a stranger

A visitor who opens yaks.app's pages, types in a box or signs up is read as a
person in /admin, the funnel and the people list, unless their visit says
otherwise. Jeff, after an agent's check through the /churches box showed up in
admin as an anonymous visitor:

> yeah, just add someway to mark every demo so we don't get confused. or use
> staging

- **Staging first.** Check the home page, its variants (/churches), the box,
  sign-up and the funnel as a stranger on staging, `https://yaks.fyi`. It
  deploys the same commit right after production, and nothing a check leaves
  there reaches production's admin or funnel.
- **On yaks.app, send it with curl or Deno's fetch, as they are.** Their user
  agents name them as scripts. The newcomer the box opens for a script, and
  every step, failure and app error after it, is counted apart from people
  (workers/yak directory.ts `testIs`, crawlers.ts `classed`). Never set a
  browser's user agent on a check.
- **A check that has to look like a browser** tags its visit
  `utm_source=agent-check` (@yaks/platform/bots `CHECK`), in its link or its
  `yak_came` cookie. Its newcomer is then a test too.

## A live page in a browser

`yak admin browse` opens a page of yaks.app in Cloudflare's browser, through
the yak-browser Worker, signed in as the account you name, and takes the
steps a person takes. Nothing runs on the box. The window is a phone's,
390 × 844 with touch, unless you name one. Each screenshot is written to
`.scratch/browse/<name>.png` in your checkout, the last as `end.png`, and the
answer gives the HTTP status, the page's errors and its visible text. Read the pictures with the Read tool.

```sh
yak admin browse /manage/checks/operator --as checks
yak admin browse /manage/checks/operator --as checks --steps @.scratch/say.json
yak admin browse https://checks.yaks.app/roster/ --width 1280 --height 800 --touch=false --as checks
yak admin browse /manage/checks/people --dark --as checks   # the dark theme
```

`--steps` is a JSON array, run in order once the page loads:

| step                    | what a person does                                      |
| ----------------------- | ------------------------------------------------------- |
| `{"tap": "<selector>"}` | taps the first one shown (a click when the window has no touch) |
| `{"type": "hi", "into": "<selector>"}` | types, into that element or whatever has focus |
| `{"clear": "<selector>"}` | selects all of a field and deletes it                 |
| `{"press": "Enter"}`    | presses one key                                         |
| `{"swipe": [x1, y1, x2, y2]}` | drags a finger                                    |
| `{"keyboard": 336}`     | opens a phone's keyboard that many pixels tall; `0` closes it |
| `{"wait": 2000}`        | waits, in milliseconds                                  |
| `{"shot": "typed"}`     | takes a screenshot named `typed`                        |

A wait that expires ends the visit with a refusal naming what it waited for.
Other step errors can end the steps and return a screenshot and page
diagnostics. A headless browser turns every permission ask down, so a page
that offers what one allows (the Operator's offer of alerts) shows nothing
until the visit holds it: `--allow notifications` opens the page as a person
who allowed them. A headless browser has no on-screen keyboard, so `keyboard`
shrinks the window by its height, which is what a phone does for our pages:
they ask for `interactive-widget=resizes-content` (workers/yak/pages.ts).

Saying something in checks' own chat (`/manage/checks`), as the person, with
the keyboard open. A draft is kept across visits, so clear the field first:

```json
[
  { "tap": "textarea" },
  { "keyboard": 336 },
  { "clear": "textarea" },
  { "type": "A check from T-1637: hello", "into": "textarea" },
  { "shot": "typed" },
  { "tap": ".Composer button[type=submit]" },
  { "wait": 8000 },
  { "shot": "sent" }
]
```

The sign-in needs nothing from you. The checks connection on this box keeps a
website session in its vault record beside its OAuth grant. The platform
slides it forward as it is used. A website act signs checks in again when the
session is missing or expired. `admin browse` also retries a rejected session
using the code mailed to this graph (packages/admin/account.ts). A browser
visit defaults to checks. For `/admin` pages, run
`yak admin browse /admin/spending --as admin`. The private forwarder uses the
admin bot's OAuth grant. The remote browser receives a short-lived cookie for
`/admin` pages. To see a page as a member, invite a test bot in
the role you're checking, accept the invitation with `yak admin accept`, and
pass that bot's account to `--as`. Visits can open pages on yaks.app's own
hosts. For a page off yaks.app, thum.io renders a public URL
(`https://image.thum.io/get/png/width/<w>/<url>`), but never narrower than
500px.

The iOS shell's CI check (.github/workflows/ios-shell.yml) signs in with a
year-long checks link kept as a repository secret; its header says how to mint
the next one, and a wake on the project comes back a month before it expires.

When this skill is wrong or missing something, fix it in the same change.
