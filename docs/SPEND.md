# See what your coding agents spent

yak reads the transcripts Claude Code and Codex already keep on your computer
and shows what they cost: by day, model, session and part of the context, at
each model's list price, beside the weekly limits of the plans they ran on. It
reads every account each one keeps on your computer, needs nothing configured,
and keeps everything on your machine.

## Install on a Mac

You need [Deno](https://deno.com) 2.9 or later.

```sh
brew install deno        # or: curl -fsSL https://deno.land/install.sh | sh
deno run -A jsr:@yaks/cli/install
```

The installer takes `yak` and its plugins from [jsr.io](https://jsr.io/@yaks)
and puts the command in `~/.deno/bin`. If that folder isn't on your `PATH` yet,
add it (`echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.zshrc`) and open a new
terminal. It installs the newest release at least a day old, since Deno waits a
day for a new one. To update later, run the same line with
`--reload=jsr:@yaks/cli` added: Deno remembers the release it found last, and
the flag asks jsr.io again.

## See your spend

```sh
yak init
yak serve
```

Open <http://127.0.0.1:8787/spend>, the address `yak serve` prints.

While `yak serve` runs it reads every transcript the two agents have written,
and keeps reading new ones as they appear. Each day on the page fills in as its
transcripts are read, about thirty a minute, so a long history takes a while to
appear in full. Stop it with Ctrl-C; the next `yak serve` carries on reading.

To fill your history at once, read every transcript from a day on yourself:

```sh
yak spend backfill 2026-10-01
```

It reads each transcript written since that day to its end, measures its
requests and tallies each day, then says how many requests it measured. Run it
again any time; what it has already read is not read twice.

The same report is in the terminal: `yak spend show` for this week, or
`yak spend show 2026-10-01` from a day on.

## Several accounts

Each Claude Code or Codex account keeps its sign-in and its transcripts in a
directory of its own: `~/.claude` and `~/.codex`, and any other you start one
with, as in `CLAUDE_CONFIG_DIR=~/.claude-work claude` or
`CODEX_HOME=~/.codex-work codex`. yak reads every `~/.claude*` and `~/.codex*`
directory that holds transcripts, finding a new one within a minute, and the
Spend page shows each account apart: what its requests cost this week, beside
the total, and its own plan's limits. An account kept somewhere else is listed
in `~/.yak/yak.json`, in place of the plain `"@yaks/session"` entry:

```json
{ "use": "@yaks/session", "with": { "homes": ["/Volumes/work/claude"] } }
```

## What the numbers mean

- **Dollars** are what the requests would cost at the model's list price, from
  the table in [packages/model/prices.json](../packages/model/prices.json). A
  model the table doesn't know reads `unpriced` instead of a number. To price
  one, or to change one, set a price on its row, in dollars per million tokens:
  `yak graph apply claude-sonnet-4-5 .price.input=3 .price.output=15 .price.cached=0.3`.
- **Week %** is a row's share of its account's weekly limit. Codex reports its
  limits in its transcripts, so each Codex account's share appears on its own.
  Claude Code reports them only to a status line, so a Claude account's share
  appears only where one is set up to keep them (see
  [packages/spend](../packages/spend/README.md)).

## Updating

Run the install line with `--reload=jsr:@yaks/cli` added, which asks jsr.io for
the newest release a day old; running it unchanged keeps the release Deno found
before. `--minimum-dependency-age=0` takes a release published today.

```sh
deno run -A --minimum-dependency-age=0 --reload=jsr:@yaks/cli jsr:@yaks/cli/install
```

Restart `yak serve` if it is running.

## The rest of yak

The same graph holds tasks, projects, memories and agent sessions, which the
[README](../README.md) introduces.
