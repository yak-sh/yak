#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net=registry.cloudflare.com --allow-env=WRANGLER_CI_OVERRIDE_NETWORK_MODE_HOST --allow-run=npm,npx,git,pgrep,kill,docker,env
// The one door to this Worker's wrangler: `deno task deploy:yak`,
// `deno task dev:yak`, their `-staging` variants and the test runner
// (bin/test.ts) all come through here, so the pinned version is written once
// and `node_modules` is current before wrangler reads it.
//
// Why the install has to happen first: wrangler bundles with esbuild, which
// resolves `zod` and the MCP SDK as files under this directory's
// `node_modules` (wrangler.toml `[alias]`). node_modules is gitignored, so a
// fresh worktree has none and every wrangler command dies unresolved at
// mcp.ts's `import { z } from 'zod'` (T-34159). npm is the only thing that
// fills that directory: esbuild wants files on disk, so no import map or
// deno cache reaches those two deps. Deno reads from it too: the kernel in
// memory imports the OAuth provider as a file there (oauth-provider.ts), so a
// test run installs before its first test loads.

// The pin. `--yes` so a cold npx cache installs it instead of asking.
//
// It has a floor, not just a version: `send_email` is Email Sending's binding
// now, whose `send()` takes `{from, to, subject, text, html}` and answers
// `{messageId}` (post.ts), and miniflare only grew that shape late — 4.42.2's
// stand-in knew the old Email Routing binding alone and bounced every letter
// with `could not parse email` (T-34179). Never pin below a wrangler whose
// miniflare simulates the builder; mail_test.ts holds it.
//
// And not the newest either: 4.128.0 boots the same probes three times slower
// and drops kernels under parallel load (`Network connection lost`), where
// 4.111.0 runs them at the old pin's pace. Measure before moving.
// Exact pins can reuse npm's restored cache without registry revalidation.
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import packages from './package.json' with { type: 'json' }
import { based } from './sandbox/base.ts'

export let WRANGLER = [
  'npx',
  '--yes',
  '--prefer-offline',
  `wrangler@${packages.devDependencies.wrangler}`,
]

export let dir = fileURLToPath(new URL('./', import.meta.url)).replace(
  /\/$/,
  '',
)

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

// Where a `@yaks/*` name goes when esbuild bundles. The kernel imports the
// packages by name, which deno resolves through the repo's workspace; esbuild
// knows nothing of the workspace. So the workspace itself is handed to it:
// every member's name and exports, read out of its deno.json, written as the
// tsconfig `paths` wrangler.toml points esbuild at. A package the kernel starts
// importing is bundled because it is in the workspace, never because somebody
// remembered to list it.
export let TSCONFIG = `${dir}/.wrangler/paths.json`

let repo = fileURLToPath(new URL('../../', import.meta.url))

type Member = { name?: string; exports?: string | Record<string, string> }

/** Every import name the workspace exports, to the file it is. */
export let members = (root = repo): Record<string, string> => {
  let config = (at: string) =>
    JSON.parse(Deno.readTextFileSync(join(root, at, 'deno.json')))
  let { workspace = [] } = config('.') as { workspace?: string[] }
  return Object.fromEntries(workspace.flatMap((at) => {
    let { name, exports } = config(at) as Member
    if (!name || exports == null) return []
    let map = typeof exports == 'string' ? { '.': exports } : exports
    return Object.entries(map).map(([sub, file]) => [
      name + sub.slice(1),
      join(root, at, file),
    ])
  }))
}

/**
 * Write {@link TSCONFIG}: the workspace as `paths`, relative to the file.
 * Through a rename, so a parallel probe never reads half of one.
 */
export let aliased = (root = repo, to = TSCONFIG) => {
  let paths = Object.fromEntries(
    Object.entries(members(root)).map((
      [name, file],
    ) => [name, [relative(dirname(to), file)]]),
  )
  Deno.mkdirSync(dirname(to), { recursive: true })
  let tmp = `${to}.${Deno.pid}`
  Deno.writeTextFileSync(tmp, JSON.stringify({ compilerOptions: { paths } }))
  Deno.renameSync(tmp, to)
}

/**
 * `npm ci` when it is needed, at most one at a time, and never twice at once:
 * `npm ci` empties node_modules before it fills it, and more than one process
 * may ask at once (a test run beside `dev:yak`), so a second install would
 * delete the tree the first is bundling from. mkdir is the atomic create POSIX
 * gives us — whoever makes the directory installs, everyone else waits for the
 * stamp. Answers whether it installed. The workspace's paths are written first
 * ({@link aliased}), so everything wrangler bundles from is current.
 */
export let ready = async (root = dir, timeout = 600_000) => {
  aliased()
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
      args: ['ci', '--prefer-offline', '--no-audit', '--no-fund'],
      cwd: root,
      stdin: 'null',
    }).spawn().status
    if (code) throw new Error(`npm ci in ${root} exited ${code}`)
    return true
  } finally {
    Deno.removeSync(lock)
  }
}

// Wrangler accepts --env on either side of the command. Both forms need
// the same commit annotation, so production and staging identify one build.
export let command = (args: string[]) => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] == '--env' || args[i] == '-e') i++
    else if (!args[i].startsWith('--env=')) return args[i]
  }
}

// The Workers this one is a contract with, each deployed first, from the same
// commit and to the same environment, so no Worker is ever deployed by hand:
// yak-out (outbound/) is this Worker's dispatch namespace's outbound Worker,
// handing every fetch an app makes back to this Worker's `Outbound`
// entrypoint, and yak-esbuild (esbuild/) is what the ESBUILD binding compiles
// an app with at deploy (@yaks/esbuild). Both exist before this Worker's
// bindings name them.
export let SIBLINGS = ['outbound/wrangler.toml', 'esbuild/wrangler.toml']

// Each sibling's deploy arguments, or none when these arguments are not a
// deploy or already name a config of their own.
export let siblings = (argv: string[]): string[][] =>
  command(argv) != 'deploy' ||
    argv.some((a) => /^(-c|--config)(=|$)/.test(a))
    ? []
    : SIBLINGS.map((c) => [...argv, '-c', c, '--containers-rollout=none'])

// What Workers Builds pins to this Worker. Inherited by another Worker's
// deploy, the first deploys it under this Worker's name and the second fails
// its tag check, so each sibling's deploy runs without them (bin/build-yak drops
// them for staging the same way).
export let PINNED = ['WRANGLER_CI_OVERRIDE_NAME', 'WRANGLER_CI_MATCH_TAG']

// Every process under `pid`, children before parents. Through pgrep(1):
// reading /proc is something Deno grants only to --allow-all.
export let descendants = (pid: number): number[] => {
  let out = new Deno.Command('pgrep', { args: ['-P', String(pid)] })
    .outputSync()
  let kids = new TextDecoder().decode(out.stdout).split('\n').filter(Boolean)
    .map(Number)
  return kids.flatMap((kid) => [...descendants(kid), kid])
}

// ---- which commit may go live ----------------------------------------------
//
// Workers Builds runs one build per push, and the builds finish in whatever
// order they finish: three pushes a minute apart once went live with the
// middle one last. So a deploy asks two things before it uploads anything —
// is this commit still main's tip, and is no live version ahead of it — and
// stops on either "no", leaving the newer build to deploy. A live version that
// is neither behind nor ahead (a commit that never reached main) is replaced:
// main is what runs. What could not be read refuses nothing, and is printed.

/** What a deploy sees: its own commit, main's tip at the remote (null when the
 * remote could not be asked), and each commit a live version was deployed
 * from, with whether it is ahead of this one (null when git cannot tell). */
export type Seen = {
  head: string
  tip: string | null
  live: { sha: string; ahead: boolean | null }[]
}

let short = (sha: string) => sha.slice(0, 8)

/** Why this commit must not go live, or null when it may. */
export let superseded = ({ head, tip, live }: Seen): string | null => {
  if (tip && tip != head) {
    return `main is at ${short(tip)}, past ${short(head)}; its build deploys it`
  }
  let newer = live.find((l) => l.ahead)
  return newer
    ? `${short(newer.sha)} is live and ahead of ${short(head)}`
    : null
}

let git = async (root: string, ...args: string[]) => {
  let r = await new Deno.Command('git', {
    args,
    cwd: root,
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return { code: r.code, out: new TextDecoder().decode(r.stdout).trim() }
}

let SHA = /^[0-9a-f]{40}\b/

/**
 * What a deploy from `root`'s checkout sees, given the commits live now. A
 * live commit this clone lacks is fetched first: it was pushed after the clone
 * was made, and a shallow clone holds only the commits it was made with.
 */
export let seen = async (root: string, live: string[]): Promise<Seen> => {
  let head = (await git(root, 'rev-parse', 'HEAD')).out
  let asked = await git(root, 'ls-remote', 'origin', 'refs/heads/main')
  let tip = asked.code ? null : SHA.exec(asked.out)?.[0] ?? null
  let ahead = async (sha: string) => {
    if (sha == head) return false
    if ((await git(root, 'cat-file', '-e', `${sha}^{commit}`)).code) {
      await git(root, 'fetch', '--quiet', 'origin', sha)
    }
    let { code } = await git(root, 'merge-base', '--is-ancestor', head, sha)
    return code == 0 ? true : code == 1 ? false : null
  }
  return {
    head,
    tip,
    live: await Promise.all(
      live.map(async (sha) => ({ sha, ahead: await ahead(sha) })),
    ),
  }
}

// A command's `--env` arguments, as it wrote them.
let envs = (args: string[]): string[] =>
  args.flatMap((a, i) =>
    a == '--env' || a == '-e'
      ? [a, args[i + 1]]
      : a.startsWith('--env=')
      ? [a]
      : []
  )

/** The commits the versions live now were deployed from, as the message this
 * door gives every version says (`--message` below), in the deploy's own
 * environment. Anything wrangler will not answer names no commit. */
let serving = async (env: string[]): Promise<string[]> => {
  let read = async (args: string[]) => {
    let r = await new Deno.Command(WRANGLER[0], {
      args: [...WRANGLER.slice(1), ...args, ...env, '--json'],
      cwd: dir,
      stdout: 'piped',
      stderr: 'null',
    }).output()
    try {
      return r.success ? JSON.parse(new TextDecoder().decode(r.stdout)) : null
    } catch {
      return null
    }
  }
  let deployments: {
    created_on: string
    versions: { version_id: string; percentage: number }[]
  }[] = await read(['deployments', 'list']) ?? []
  let now =
    deployments.toSorted((a, b) =>
      Date.parse(b.created_on) - Date.parse(a.created_on)
    )[0]
  let named = await Promise.all(
    (now?.versions ?? []).filter((v) => v.percentage > 0).map(async (v) => {
      let version = await read(['versions', 'view', v.version_id])
      return SHA.exec(version?.annotations?.['workers/message'] ?? '')?.[0]
    }),
  )
  return named.filter((sha) => sha != null)
}

if (import.meta.main) {
  await ready()
  let argv = [...Deno.args]
  if (command(argv) === 'deploy' && !argv.includes('--dry-run')) {
    let saw = await seen(dir, await serving(envs(argv)))
    let live = saw.live.map((l) => short(l.sha) + (l.ahead == null ? '?' : ''))
    console.log(
      `deploy ${short(saw.head)}: main at ${
        saw.tip ? short(saw.tip) : '(unread)'
      }, live ${live.join(' ') || '(unread)'}`,
    )
    let why = superseded(saw)
    if (why) {
      console.log(`not deploying: ${why}`)
      Deno.exit(0)
    }
  }
  if (command(argv) === 'deploy') {
    // Versions carry their commit so `yak admin deploys` need not infer it by time.
    let commit = await new Deno.Command('git', {
      args: ['log', '-1', '--format=%H %s'],
      cwd: dir,
      stdout: 'piped',
      stderr: 'inherit',
    }).output()
    if (!commit.success) Deno.exit(commit.code)
    argv.push('--message', new TextDecoder().decode(commit.stdout).trim())
    // The sandbox image builds FROM a base the registry must already hold
    // (sandbox/base.ts), unless this deploy builds no image at all.
    if (!/(^| )--containers-rollout[= ]none( |$)/.test(argv.join(' '))) {
      await based({ wrangler: WRANGLER, dry: argv.includes('--dry-run') })
    }
  }
  let child: Deno.ChildProcess | undefined
  // A signal to this door reaches wrangler too; otherwise a stopped `tail`
  // leaves wrangler streaming and its reader waiting on a pipe that never
  // closes (verify-deploy.ts hung ten minutes on a three-minute tail). The
  // child is npx, which does not pass a signal to the wrangler it spawned, so
  // the whole subtree is signalled, deepest first. Through kill(1), not
  // Deno.kill: that needs the unrestricted run permission, and this door
  // runs with an allowlist (npm, npx, git, pgrep, kill, docker, env).
  for (let signal of ['SIGINT', 'SIGTERM'] as const) {
    Deno.addSignalListener(signal, () => {
      if (!child) return
      let pids = [...descendants(child.pid), child.pid].map(String)
      new Deno.Command('kill', {
        args: ['-s', signal.slice(3), ...pids],
        stderr: 'null',
      }).spawn()
    })
  }
  // env(1) execs wrangler in its own place, so the pid signalled is the same.
  let run = async (argv: string[], unpinned = false) => {
    let [cmd, ...args] = unpinned
      ? ['env', ...PINNED.flatMap((v) => ['-u', v]), ...WRANGLER]
      : WRANGLER
    child = new Deno.Command(cmd, { args: [...args, ...argv], cwd: dir })
      .spawn()
    return (await child.status).code
  }
  for (let args of siblings(argv)) {
    let code = await run(args, true)
    if (code) Deno.exit(code)
  }
  Deno.exit(await run(argv))
}
