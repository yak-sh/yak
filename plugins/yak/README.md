# yak for Claude Code

Every Claude Code session becomes a session in your yak graph, with the graph's
tools beside it, and a conversation can move between Claude Code and any model
yak runs without retelling it.

## Install

With `yak serve` running on this machine:

```sh
claude plugin marketplace add yak-sh/yak
claude plugin install yak@yak
yak hooks install
```

Inside Claude Code, `/plugin install yak --marketplace yak-sh/yak` does the
first two. `yak hooks install` points the plugin at your `yak serve`, takes out
any hooks an earlier install wrote by hand, and sets the status line, which a
plugin cannot set itself.

## What it carries

- **The session hooks.** Each session, its tool calls and its end are reported
  to `yak serve`, which reads the session into the graph and tells it what it
  holds and what was said to it.
- **The graph's tools,** through `yak mcp`, each call naming its session.
- **`/yak:continue`,** answered before Claude Code asks its model anything, so
  it works when your Claude plan is spent:
  - `/yak:continue codex/gpt-5.5 fix the test` hands this conversation to that
    model in yak, which goes on from your words. Follow it in `yak session tui`.
  - `/yak:continue S-12` writes session S-12 (from Codex, Grok, Antigravity or
    yak's own harness) into this account; `/resume <its id>` then continues it
    here.
  - `/yak:continue` alone says how much room each plan has left.
- **The status line,** once `yak hooks install` has run: this session's model
  and context, then each plan's room, this one's first.

  ```
  Opus 5.5 ctx 42% │ claude-work 5h 8% (90m) · wk 60% │ codex wk 70%
  ```

## Options

`server` is where `yak serve` listens, `http://127.0.0.1:8787` by default.
`yak hooks install` sets it to your graph's; `/plugin` changes it by hand.
