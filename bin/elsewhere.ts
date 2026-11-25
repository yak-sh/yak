// A heavy command runs on the machine named for it, so its memory is that
// machine's and not the box's, where the agents are (T-1463). A clone names
// one with `git config yak.machine <address>`, a @yaks/machine address such
// as ssh://yak@34.186.247.59, and whatever starts the work may name another
// with YAK_MACHINE in its environment. The machine is set up by
// bin/run-machine-setup: a bare clone of origin at ~/repo.git, and its runs
// under ~/runs.
//
// A run there is this checkout as it stands: a worktree reset to the commit
// the work builds on, which the machine fetches from origin when it has not
// got it, and every change since, committed, staged, unstaged or untracked,
// sent as one binary diff and applied to the index. The command starts in its
// own systemd scope with the caller's limits (@yaks/machine/execution), so a
// run that grows past its cap is the one ended. What it prints comes back as
// it prints it, and its exit code is the caller's.
//
// A run waits for the machine's measured headroom (@yaks/machine/room).
// Full runs also reserve room for workloads that have only just started.
//
// A run goes elsewhere when it can, and that is never why it fails: with no
// machine named, or one that cannot be reached or cannot take the change, the
// caller runs the command here. To run one here on purpose:
//
//   YAK_MACHINE= deno task test

import { follow } from '@yaks/machine'
import type { ComputerTransport } from '@yaks/machine'
import {
  computer,
  localConnector,
  quote,
  sshConnector,
} from '@yaks/machine/connectors'
import { executionWorkspace } from '@yaks/machine/execution'
import { fits, NEED, room, roomOf, SCRIPT } from '@yaks/machine/room'
import { sleep } from '@yaks/fp'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { processDoc } from '@yaks/process/vocab'

/** Git's answer to `args` with `env` beside this process's, as bytes. */
export type Git = (
  args: string[],
  env?: Record<string, string>,
) => Promise<Uint8Array>

export let git: Git = async (args, env) => {
  let result = await new Deno.Command('git', {
    args,
    env,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    throw new Error(
      `git ${args[0]} refused: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    )
  }
  return result.stdout
}

let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim()

/** The machine heavy commands go to, if one is named: by `YAK_MACHINE`, set
 * by whatever starts the work (empty for here), or else by the clone. */
export let machine = async (
  run: Git = git,
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): Promise<string | undefined> => {
  let named = env('YAK_MACHINE') ??
    await run(['config', '--get', 'yak.machine']).then(text, () => '')
  return named || undefined
}

/**
 * This checkout's work since `from`, as one binary diff: every change git
 * would commit with `git add -A`, made in a copy of the index so the
 * checkout's own stays as it is.
 */
export let work = async (from: string, run: Git = git): Promise<Uint8Array> => {
  let index = await Deno.makeTempFile({ prefix: 'elsewhere-index-' })
  try {
    let own = text(
      await run(['rev-parse', '--path-format=absolute', '--git-path', 'index']),
    )
    await Deno.copyFile(own, index).catch((e) => {
      if (!(e instanceof Deno.errors.NotFound)) throw e
    })
    let env = { GIT_INDEX_FILE: index }
    await run(['add', '-A'], env)
    let tree = text(await run(['write-tree'], env))
    return await run([
      'diff',
      '--binary',
      '--full-index',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      from,
      tree,
    ])
  } finally {
    await Deno.remove(index)
  }
}

let base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(out)
}

/** Where run `id` lives on its machine, and the clone its trees come from. */
let place = (id: string) => `repo=$HOME/repo.git run=$HOME/runs/${id}`

/** Transfer a patch before launching its run. */
export let stage = (id: string, diff: Uint8Array) =>
  `set -eu
${place(id)}
mkdir -p -- "$run"
printf '%s' ${quote(base64(diff))} | base64 -d > "$run/work.diff"
printf '%s' "$run"`

let checkout = (from: string) =>
  `{
  flock 9
  git -C "$repo" cat-file -e ${quote(from + '^{commit}')} 2>/dev/null ||
    git -C "$repo" fetch -q origin
  if test -f "$tree/.git"; then
    reuse=1
  else
    reuse=0
    git -C "$repo" worktree prune
    git -C "$repo" worktree add -q --detach "$tree" ${quote(from)}
  fi
} 9>"$repo/runs.lock"
cd "$tree"
if test "$reuse" = 1; then
  previous=$(git write-tree)
  git checkout -q --force --detach ${quote(from)}
  git clean -q -ffdx -e node_modules
fi
if test -s "$run/work.diff"; then git apply --index --binary "$run/work.diff"; fi
if test "$reuse" = 1 &&
   ! git diff --cached --quiet "$previous" -- package.json ':(glob)**/package.json' pnpm-workspace.yaml .npmrc patches; then
  rm -f node_modules/.pnpm/lock.yaml
fi
bin/workspace-dependencies > "$run/dependencies.log" 2>&1 ||
  { cat "$run/dependencies.log" >&2; exit 1; }`

/**
 * The control script making run `id` ready on its machine: a worktree at
 * `from`, fetched from origin when the machine has not got it, with `diff`
 * applied and the checkout's dependencies installed (bin/workspace-dependencies,
 * whose install log is said only when it fails). It answers the run's
 * directory. The machine's clone takes one run's fetch and worktree at a
 * time.
 */
export let prepare = (id: string, from: string, diff: Uint8Array) =>
  `${stage(id, diff)} >/dev/null
tree=$run/tree
${checkout(from)}
printf '%s' "$run"`

/** Scoped checks can keep one checkout's compiler caches warm. Hold its
 * flock for the command's lifetime. A second run starts in its own tree
 * immediately. The Git base, applied work and untracked files are per run. */
export let scoped = (id: string, from: string, cmd: string) =>
  `set -eu
${place(id)}
tree=$run/tree
exec 8>"$HOME/runs/.scoped.lock"
if flock -n 8; then tree=$HOME/runs/.scoped; else exec 8>&-; fi
${checkout(from)}
touch "$run/prepared"
( ${cmd} )`

/** The control script removing run `id` and its worktree, in the background:
 * a run's tree is hundreds of megabytes, and its caller need not wait. Deno
 * keys its caches by a module's path, and every run's path is new, so the
 * entries under it go too: its emitted files and its rows in the code and
 * analysis caches, whose freed pages the next runs reuse. */
export let tidy = (id: string) =>
  `${place(id)}
setsid bash -c '
rm -rf -- "$1"; git -C "$2" worktree prune
for dir in "$HOME"/.cache/deno*/; do
  rm -rf -- "$dir/gen/file$1"
  for db in v8_code_cache_v2:codecache dep_analysis_cache_v2:moduleinfocache; do
    test -f "$dir/\${db%%:*}" && sqlite3 -cmd ".timeout 60000" "$dir/\${db%%:*}" \\
      "DELETE FROM \${db#*:} WHERE specifier LIKE '"'"'file://$1/%'"'"'"
  done
done' tidy "$run" "$repo" </dev/null >/dev/null 2>&1 &`

/// command(['deno', 'task', 'test', 'a b'], { A: '1' }) -> "A='1' exec 'deno' 'task' 'test' 'a b'"
/** `argv` as one command line, with `env` set for it. */
export let command = (argv: string[], env: Record<string, string> = {}) =>
  [
    ...Object.entries(env).map(([name, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new Error('Invalid environment name: ' + name)
      }
      return `${name}=${quote(value)}`
    }),
    'exec',
    ...argv.map(quote),
  ].join(' ')

/**
 * The control script reading a machine's room (@yaks/machine/room), and last
 * how many runs began there within a run's settling time. Those have not
 * grown yet, so the machine's reading does not count them: they are what a
 * run arriving with others in a burst sees held.
 */
export let ROOM = `${SCRIPT}
find "$HOME/runs" -mindepth 1 -maxdepth 1 -type d ! -name .scoped -newermt "@$(($(date +%s) - ${
  NEED.settle / 1000
}))" 2>/dev/null | wc -l`

/// roomy('MemAvailable: 9437184 kB\nsome avg10=0.00 avg60=0.00\n1\n') -> true
/// roomy('MemAvailable: 9437184 kB\nsome avg10=0.00 avg60=0.00\n2\n') -> false
/// roomy('MemAvailable: 9437184 kB\nsome avg10=25.00 avg60=0.00\n0\n') -> false
/** Whether one more run fits, from what {@link ROOM} printed. */
export let roomy = (out: string) =>
  fits(roomOf(out), NEED, Number(out.trim().split('\n').at(-1)))

/** Scoped work uses the machine's measured headroom. Full runs can grow for
 * minutes, so their admission still accounts for recently started runs. */
export let hasRoom = async (transport: ComputerTransport, whole: boolean) =>
  whole ? roomy(await transport.execute(ROOM)) : fits(await room(transport))

/** The connectors a clone's machine may be reached by. Their options come
 * from the box's ssh configuration, never from the address. */
let reach = (address: string) =>
  computer(address, { local: localConnector(), ssh: sshConnector() })

let stdout = async (bytes: Uint8Array) => {
  while (bytes.length) bytes = bytes.subarray(await Deno.stdout.write(bytes))
}

export type Options = {
  /** the machine's address, or none for here: by default, the one named */
  named?: () => Promise<string | undefined>
  /** the commit the work builds on, asked once a machine is named */
  from: () => Promise<string>
  /** what the command does to this checkout itself, done here before its
   * work is taken, since the copy there is thrown away */
  before?: () => Promise<unknown>
  /** what the command's environment adds */
  env?: Record<string, string>
  /** the command's systemd scope properties, such as `MemoryMax=6G` */
  limits?: string[]
  /** Whether to reserve headroom for other starts that are still growing. */
  whole?: boolean
  run?: Git
  connect?: (address: string) => Promise<ComputerTransport>
  write?: (bytes: Uint8Array) => Promise<void>
  say?: (line: string) => void
  /** how a run waiting for room waits between looks */
  pause?: (ms: number) => Promise<void>
}

/**
 * Run `argv` on this clone's machine in a copy of this checkout's work, and
 * answer its exit code; or nothing, once said why, when it ran nowhere and
 * the caller is to run it here. A run that loses its machine partway is ended
 * there where it can be, and the caller runs it here from the start; an
 * interrupted one is ended there, and answers as interrupted.
 */
export let elsewhere = async (
  argv: string[],
  {
    from,
    env = {},
    limits = [],
    whole = true,
    run = git,
    connect = reach,
    write = stdout,
    say = (line) => console.error(line),
    pause = sleep,
    named = () => machine(run),
    before = () => Promise.resolve(),
  }: Options,
): Promise<number | undefined> => {
  let address = await named()
  if (!address) return
  let id = crypto.randomUUID()
  let transport: ComputerTransport | undefined
  let end = () => Promise.resolve()
  let interrupted = false
  let interrupt = () => {
    interrupted = true
    void end()
  }
  Deno.addSignalListener('SIGINT', interrupt)
  Deno.addSignalListener('SIGTERM', interrupt)
  try {
    transport = await connect(address)
    let at = await from()
    await before()
    let diff = await work(at, run)
    // A run waits for room there, as an agent waits for room here: the
    // machine slows down rather than falls over.
    let interval = whole ? 5_000 : 500
    for (let n = 0; !await hasRoom(transport, whole); n++) {
      if (n * interval % 60_000 == 0) {
        say(`elsewhere: ${address} has no room yet; waiting`)
      }
      await pause(interval)
      if (interrupted) return 130
    }
    let staging = whole ? prepare(id, at, diff) : stage(id, diff)
    let dir = (await transport.execute(staging)).trim()
    if (!dir.startsWith('/')) throw new Error('the machine named no run')
    let vocab = loadVocab([processDoc])
    let workspace = executionWorkspace(
      graph({ storage: ram(vocab), vocab }),
      transport,
      {
        workspace: id,
        root: whole ? `${dir}/tree` : dir,
        receipts: `${dir}/receipts`,
        limits,
      },
    )
    if (interrupted) return 130
    let cmd = command(argv, env)
    let process = await workspace.start(whole ? cmd : scoped(id, at, cmd))
    end = () => workspace.kill(process, 'SIGTERM').catch(() => {})
    if (interrupted) await end()
    let ended = await follow(workspace, process, write)
    let code = ended?.exit?.code
    if (interrupted) return 130
    if (
      !whole && code &&
      (await workspace.stat(['prepared']))[0]?.kind == 'missing'
    ) {
      throw new Error('could not prepare the scoped checkout')
    }
    if (code == null) {
      say(`elsewhere: ${address}: the run ended with no exit code`)
    }
    return code ?? 1
  } catch (e) {
    await end()
    if (interrupted) return 130
    say(`elsewhere: ${address}: ${(e as Error).message.trim()}; running here`)
    return
  } finally {
    Deno.removeSignalListener('SIGINT', interrupt)
    Deno.removeSignalListener('SIGTERM', interrupt)
    await transport?.execute(tidy(id)).catch(() => {})
  }
}
