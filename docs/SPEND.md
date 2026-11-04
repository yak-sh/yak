# See what your coding agents spent

yak reads the transcripts Claude Code and Codex already keep on your computer
and shows what they cost: by day, model, session and part of the context, at
each model's list price, beside the weekly limits of the plans they ran on. It
reads `~/.claude/projects` and `~/.codex/sessions` (or `$CODEX_HOME/sessions`),
needs nothing configured, and keeps everything on your machine.

## Install on a Mac

You need [Deno](https://deno.com) 2.9 or later.

```sh
brew install deno        # or: curl -fsSL https://deno.land/install.sh | sh
deno run -A --minimum-dependency-age=0 jsr:@yaks/cli/install
```

The installer takes `yak` and its plugins from [jsr.io](https://jsr.io/@yaks)
and puts the command in `~/.deno/bin`. If that folder isn't on your `PATH` yet,
add it (`echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.zshrc`) and open a new
terminal. `--minimum-dependency-age=0` lets it take a release published today,
which Deno otherwise waits a day for.

## See your spend

```sh
yak init "Your Name"
yak serve
```

Open <http://127.0.0.1:8787/spend>, the address `yak serve` prints.

While `yak serve` runs it reads every transcript the two agents have written,
and keeps reading new ones as they appear. Each day on the page fills in as its
transcripts are read, about thirty a minute, so a long history takes a while to
appear in full. Stop it with Ctrl-C; the next `yak serve` carries on reading.

The same report is in the terminal: `yak spend show` for this week, or
`yak spend show 2026-10-01` from a day on.

## What the numbers mean

- **Dollars** are what the requests would cost at the model's list price, from
  the table in [packages/model/prices.json](../packages/model/prices.json). A
  model the table doesn't know reads `unpriced` instead of a number. To price
  one, or to change one, set a price on its row, in dollars per million tokens:
  `yak graph apply claude-sonnet-4-5 .price.input=3 .price.output=15 .price.cached=0.3`.
- **Week %** is a row's share of a plan's weekly limit. Codex reports its limits
  in its transcripts, so its share appears on its own. Claude Code reports them
  only to a status line, so Claude's share appears only where one is set up to
  keep them (see [packages/spend](../packages/spend/README.md)).

## Updating

Run the install command again. Restart `yak serve` if it is running.

## The rest of yak

The same graph holds tasks, projects, memories and agent sessions, which the
[README](../README.md) introduces.
