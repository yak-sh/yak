---
name: sharing
description: >
  Use whenever you put anything in ~/shared or make something for the owner
  to look at: a mockup, report, screenshot, image or HTML page. Also to
  publish/unpublish on public.yak.sh or explain ~/shared. yaks apps are served
  by yaks.app; this does not cover inspector or browse at tasks.yak.sh.
---

# Sharing files: `~/shared`, a web page he opens, private unless published

Jeff, verbatim:

> can you edit the skill that describes `~/shared` and make it clear that i view
> it in the webbrowser and you should be using index.html to create the page? i
> have to go digging for everything that's shared with me because the agents
> never give me a link and also don't seem to be aware that it's a just a http
> file server

And, after mockups grew to 149 MB of the repo's history:

> no large assets in git

A mockup, render, screenshot, image or raw report made to look at goes in
`~/shared/<name>/`, never the checkout, even while you iterate on it. The repo
keeps what a build reads or a shipped app serves.

## What he sees

`~/shared` is a plain HTTP file server (Caddy), and the owner reads it in his
web browser at `https://shared.yak.sh/`. He doesn't open files on the box. A
directory with an `index.html` serves that page; a directory without one serves
a bare file listing, which is where he ends up digging.

So anything you share with him is a directory with an `index.html` that is the
page he opens:

- **`~/shared/<name>/index.html`** shows the thing itself: the images inline,
  links to every HTML file beside it, a line saying what it is. Relative paths
  work, because it's just files over HTTP.
- **Every message about it gives the full link**,
  `https://shared.yak.sh/<name>/`, never only a path on the box. Sending a file
  with SendUserFile doesn't replace the link: he looks in the browser.
- **Check the link loads** before you send it: `curl -sS -o /dev/null -w
  '%{http_code}' https://shared.yak.sh/<name>/` gives 200, and so does each
  image and page it links.

## Private and public

`~/shared` (`/home/yaks/shared`) is the fleet's file-share tree. It is served
**two** ways:

- **Private (default):** the whole tree is served read-only over the owner's
  **Tailscale tailnet** at `https://shared.yak.sh/<path>` — the owner's devices
  only, not the public internet. Always write this host: the legacy
  `claude.ibis-micro.ts.net` alias resolves to a non-serving LAN address from
  the fleet box, so a link on it can't be checked where it's written.
- **Public (opt-in, per file):** a file is on the open internet at
  `https://public.yak.sh/<path>` **iff its sticky bit is set**. Nothing is
  public until you mark it.

`<path>` in both URLs is the file's path **relative to `~/shared`** — strip the
`/home/yaks/shared/` prefix. Example: `~/shared/<venture>/demo.png` →
`https://shared.yak.sh/<venture>/demo.png` (private) or
`https://public.yak.sh/<venture>/demo.png` (public, once published).

> **SAFETY — public means anyone with the link.** `public.yak.sh` is the open
> internet. **Never publish secrets, credentials, `.env`, PII, or customer
> data.** There's no directory listing, but any link you share is fully
> world-readable. The default is the private tailnet link; reach for public only
> when an outside party must open it. When in doubt, don't publish.

## `share` — the front-door command (private by default)

```bash
share <file>              # PRIVATE (default) → https://shared.yak.sh/<file>  (tailnet only)
share -p  <file>          # PUBLIC (opt-in)   → https://public.yak.sh/<file>  (open internet)
share --public <file>     # same as -p
share -f  <file>          # skip the secret-name safety check (.env, *.key, …)
```

`share` copies the file into `~/shared` and prints its link. **Private is the
default** — nothing reaches the open internet without `-p`/`--public`.
Re-running `share <file>` with **no** `-p` also **unpublishes** a
previously-public file (it clears the sticky bit). `publish` still works as a
**deprecated alias** for `share --public` (prints a rename notice), so old
muscle-memory doesn't break.

## Under the hood — the sticky-bit switch

`share` just wraps a copy plus this toggle; you can drive it by hand for files
already in `~/shared`:

```bash
chmod +t ~/shared/<venture>/<file>    # publish → https://public.yak.sh/<venture>/<file>
chmod -t ~/shared/<venture>/<file>    # unpublish → 404
```

The **sticky bit** is the switch (not `chmod +x`, which would collide with
genuinely-executable files and publish their source). On a regular file the
sticky bit is kernel-ignored and git ignores it, so publishing dirties nothing.

## How-to notes

- **The file must live under `~/shared` to be linkable at all.** A `/tmp`
  scratchpad or a path inside a repo is not served — write or copy the artifact
  into `~/shared/<venture>/` first, then link it.
- **Markdown auto-renders** to styled HTML on `public.yak.sh`; append
  **`?raw=1`** for the source.
- **Publishing a repo file:** symlink it into `~/shared` and set the sticky bit
  on the regular file — the repo stays clean (git tracks only owner-execute, not
  the sticky bit).
- **Verify** after publishing: `curl -sS https://public.yak.sh/<venture>/<file>`
  should return the content; after `chmod -t`, the same URL should 404.

Deep architecture (server, tunnel, provisioning) lives in holdco's
`docs/PUBLIC-SHARING.md` — that doc is holdco-only, so the how-to above is
self-contained for a venture.
