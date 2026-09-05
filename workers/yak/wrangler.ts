#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=npm,npx
// The one door to this Worker's wrangler: `deno task deploy:yak`,
// `deno task dev:yak` and the probe (probe.ts) all come through here, so the
// pinned version is spelled once and `node_modules` is current before wrangler
// reads it.
//
// Why the install has to happen first: wrangler bundles with esbuild, which
// resolves `zod` and the MCP SDK as FILES under this directory's
// `node_modules` (wrangler.toml `[alias]`). node_modules is gitignored, so a
// fresh worktree has none and every wrangler command dies unresolved at
// mcp.ts's `import { z } from 'zod'` (T-34159). npm is the only thing that
// fills that directory: esbuild wants files on disk, so no import map or
// deno cache reaches those two deps.

// The pin. `--yes` so a cold npx cache installs it instead of asking.
//
// It has a FLOOR, not just a version: `send_email` is Email Sending's binding
// now, whose `send()` takes `{from, to, subject, text, html}` and answers
// `{messageId}` (post.ts), and miniflare only grew that shape late — 4.42.2's
// stand-in knew the old Email Routing binding alone and bounced every letter
// with `could not parse email` (T-34179). Never pin below a wrangler whose
// miniflare simulates the builder; mail_test.ts holds it.
//
// And not the newest either: 4.128.0 boots the same probes three times slower
// and drops kernels under the parallel slow tier (`Network connection lost`),
// where 4.111.0 runs it at the old pin's pace. Measure before moving.
export let WRANGLER = ['npx', '--yes', 'wrangler@4.111.0']

export let dir = new URL('./', import.meta.url).pathname.replace(/\/$/, '')

let at = (path: string) => {
  try {
    return Deno.statSync(path).mtime?.getTime() ?? 0
  } catch {
    return 0
  }
}

/**
 * Does `node_modules` need `npm ci`? npm stamps `.package-lock.json` inside
 * the tree it just wrote, so one mtime comparison answers both "never
 * installed" (no stamp, 0) and "installed before the lock last moved".
 */
export let stale = (root = dir) =>
  at(`${root}/node_modules/.package-lock.json`) <
    at(`${root}/package-lock.json`)

/**
 * `npm ci` when it is needed, at most one at a time, and never twice at once:
 * `npm ci` EMPTIES node_modules before it fills it, and the slow tier boots
 * several kernels in parallel (bin/test.ts), so a second install would delete
 * the tree the first is bundling from. mkdir is the atomic create POSIX gives
 * us — whoever makes the directory installs, everyone else waits for the
 * stamp. Answers whether it installed.
 */
export let ready = async (root = dir, timeout = 600_000) => {
  if (!stale(root)) return false
  let lock = `${root}/node_modules.lock`
  try {
    Deno.mkdirSync(lock)
  } catch {
    let due = Date.now() + timeout
    while (stale(root)) {
      if (Date.now() > due) {
        throw new Error(
          `npm ci in ${root} never finished; if nothing is installing, ` +
            `remove ${lock}`,
        )
      }
      await new Promise((ok) => setTimeout(ok, 200))
    }
    return false
  }
  try {
    let { code } = await new Deno.Command('npm', {
      args: ['ci'],
      cwd: root,
      stdin: 'null',
    }).spawn().status
    if (code) throw new Error(`npm ci in ${root} exited ${code}`)
    return true
  } finally {
    Deno.removeSync(lock)
  }
}

if (import.meta.main) {
  await ready()
  let [cmd, ...args] = WRANGLER
  let { code } = await new Deno.Command(cmd, {
    args: [...args, ...Deno.args],
    cwd: dir,
  }).spawn().status
  Deno.exit(code)
}
