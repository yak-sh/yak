// One temp directory per run, owned by the runner. Deno.makeTempDir reads
// TMPDIR, so pointing it at `<base>/tasks-run-<pid>` puts EVERY scratch dir a
// test mints inside one directory the run can remove — whether or not the test
// that made it reached its own cleanup. Roughly two hundred test call sites
// mint one; almost none remove it, and no amount of per-test `finally` survives
// a phase the runner kills, a fixture that throws, or a child that exits.
//
// HARNESS_HOME rides along for the same reason: a harness test that forks a
// task child checks the repository out at `$HARNESS_HOME/worktrees/<child>`,
// ~160 MB a time, and nothing removes it. Left at the owner's `~/.harness`
// that reached 500 checkouts and 81 GB, and a full disk is what made
// packages/harness/task_entry_test.ts fail (T-37621). Inside the run directory
// those checkouts die with the run.
//
// Three doors close the directory: normal exit, an accepted signal, and the
// next run's stale sweep (a SIGKILLed run cannot clean up after itself, so its
// successor does it by pid). Afterwards the run reports any NEW `tasks-*`
// entry that appeared in the base directory: that is a spawn site writing to a
// hard-coded `/tmp` instead of TMPDIR, and it is how /tmp filled to 0 bytes
// free on this box three times (T-20558).
//
// That check reads the base directory, so a stray is only ATTRIBUTABLE while
// the base is this run's to watch — and the caller already says which case it
// is by naming TMPDIR or not. A named base (a scratchpad, a CI run) is nobody
// else's, so a stray there is this run's leak and fails it. An unnamed one is
// the shared `/tmp`, where this box runs CI and several worktrees at once: a
// `tasks-*` entry there may be another run's, so it prints as a warning
// naming the rule and the run passes (T-37656).

/** Where temp dirs land for a process that has not been given a run dir. */
export let tmpBase = (env: { TMPDIR?: string } = Deno.env.toObject()) =>
  env.TMPDIR || '/tmp'

/** Whether the base is this run's alone — the caller named it, so nobody
 * else mints there and a stray can be blamed on this run. */
export let ours = (env: { TMPDIR?: string } = Deno.env.toObject()) =>
  !!env.TMPDIR

/** The `tasks-*` entries of a directory — the family this repo mints. */
export let tasksEntries = (base: string) => {
  let names = new Set<string>()
  for (let e of Deno.readDirSync(base)) {
    if (e.name.startsWith('tasks-')) names.add(e.name)
  }
  return names
}

// Linux procfs, the same door bin/test.ts uses to watch a process group.
export let running = (pid: number) => {
  try {
    return Deno.statSync(`/proc/${pid}`).isDirectory
  } catch {
    return false
  }
}

/**
 * Remove the run directories of runs that are gone. A run killed outright
 * never reaches its own cleanup; its pid is the receipt that says so.
 */
export let sweep = (base: string, alive = running) => {
  let gone: string[] = []
  for (let e of Deno.readDirSync(base)) {
    let owner = /^tasks-run-(\d+)$/.exec(e.name)
    if (!owner || alive(Number(owner[1]))) continue
    try {
      Deno.removeSync(`${base}/${e.name}`, { recursive: true })
      gone.push(e.name)
    } catch {
      // Another runner's sweep won the race, or the dir is not ours to remove.
    }
  }
  return gone
}

/**
 * `tasks-*` entries that appeared while the run ran. A run directory is
 * excluded: it belongs to whichever run minted it and cleans itself up.
 */
export let strays = (base: string, before: Set<string>) =>
  [...tasksEntries(base)]
    .filter((name) => !before.has(name) && !name.startsWith('tasks-run-'))
    .sort()

if (import.meta.main) {
  if (!Deno.args.length) {
    console.error('usage: scratch.ts <command> [args...]')
    Deno.exit(2)
  }
  let env = Deno.env.toObject()
  let base = tmpBase(env)
  let mine = ours(env)
  sweep(base)
  let dir = `${base}/tasks-run-${Deno.pid}`
  Deno.mkdirSync(dir, { recursive: true })
  let before = tasksEntries(base)

  let child = new Deno.Command(Deno.args[0], {
    args: Deno.args.slice(1),
    env: { TMPDIR: dir, HARNESS_HOME: `${dir}/harness` },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn()

  // Hand the signal to the run and wait for it: the directory is only safe to
  // remove once the processes writing into it are done. A shell reads 130/143
  // the same way it reads the death itself, and reporting the leak first is
  // worth more here than dying by signal.
  let raise: Deno.Signal | undefined
  let listeners = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    let handler = () => {
      raise ??= signal
      try {
        child.kill(signal)
      } catch {
        // Already gone; the status below is the outcome.
      }
    }
    Deno.addSignalListener(signal, handler)
    return [signal, handler] as const
  })

  let status = await child.status
  for (let [signal, handler] of listeners) {
    Deno.removeSignalListener(signal, handler)
  }

  let held: unknown
  try {
    Deno.removeSync(dir, { recursive: true })
  } catch (error) {
    held = error
  }

  let leaked = strays(base, before)
  if (held) console.error(`could not remove ${dir}: ${held}`)
  if (leaked.length) {
    let many = `${leaked.length} temp entr${leaked.length == 1 ? 'y' : 'ies'}`
    console.error(
      `\n─── ${many} ${
        mine ? 'leaked outside' : 'appeared beside'
      } the run directory ───`,
    )
    for (let name of leaked) console.error(`  ${base}/${name}`)
    console.error(
      mine
        ? 'Mint scratch under TMPDIR (Deno.makeTempDir does), never a literal /tmp.'
        : `Not failing: ${base} is shared, so these may be another run's.\n` +
          'Name a base of your own (TMPDIR=<dir>) and the check is exact.',
    )
  }

  let signal = raise ?? status.signal
  if (signal) Deno.exit(signal == 'SIGINT' ? 130 : 143)
  Deno.exit(status.code || (held || (mine && leaked.length) ? 1 : 0))
}
