// One address, one graph, one server that meant to be there. `reusePort`
// turns the public port into an accept POOL: any process may join it, and the
// kernel deals each connection to whichever listener it likes. An advisory
// lock closes the check-then-bind gap: a first boot takes it exclusively,
// then holds it shared so only a declared successor may overlap.
//
// Two servers over DIFFERENT files is a coin flip per request, and the loser
// answers `no entity: T-10093` for rows that plainly exist. That reads as a
// deleted task, not as a wrong server, so the graph lies about its contents.
// Two servers over the SAME file is quieter and likelier: both answer alike,
// so nothing ever looks wrong, while a probe that forgot DB_PATH writes into
// the owner's board. Only the deploy handoff wants that, and the handoff can
// say so — so joining is opt-in (`--join`) and everything else is refused.
//
// Nothing downstream can repair either: a client has no way to ask which
// graph answered. So the check belongs here, before the join — a server asks
// the address who already serves it, and declines to be the second answer.
import { join as pathJoin, resolve } from 'node:path'

// What /graph answers: which file this process serves, and who it is.
export type Serving = { db: string; epoch: string; pid: number }

// Two in-memory graphs share a NAME but no bytes, so ':memory:' never
// matches itself — a test server must never count as the handoff peer.
export let same = (mine: string, theirs: string) =>
  mine != ':memory:' && resolve(mine) == resolve(theirs)

// Who holds the address, if anyone. Connection refused (nobody there) and a
// stranger that is not a tasks server both read as null: the class being
// closed is two GRAPHS on one port, and a stranger cannot serve a graph at
// all. Short deadline — a peer still running its migrations must not hold
// up a boot, and the permissive answer is the safe one to time out into.
export let peer = async (
  port: number,
  at = '127.0.0.1',
  run = fetch,
): Promise<Serving | null> => {
  try {
    let res = await run(`http://${at}:${port}/graph`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    let it = await res.json() as Serving
    return typeof it?.db == 'string' ? it : null
  } catch {
    return null
  }
}

// The port is the contested resource, independent of which graph hoped to
// serve it. The uid keeps unrelated users out of one another's namespace
// when XDG_RUNTIME_DIR is absent; the kernel releases its lock on every kind
// of process exit. Never unlink the empty file: a successor may still hold
// its inode, and a fresh path would let the next boot lock a different one.
let lock = (port: number) => {
  let dir = Deno.env.get('XDG_RUNTIME_DIR') ||
    Deno.env.get('TMPDIR') || '/tmp'
  return Deno.openSync(
    pathJoin(dir, `tasks-${Deno.uid()}-${port}.lock`),
    { create: true, read: true, write: true, mode: 0o600 },
  )
}

// Throws rather than exits: a function that kills the process cannot be
// tested, and the caller wants one clean line on stderr, not a stack.
//
// `join` is the supervisor's signature — dev.ts appends `--join` to a
// SUCCESSOR and to nothing else — and it permits ONLY a same-file peer: a
// stranger's graph is refused however deliberate the boot. It rides argv
// rather than the environment for the reason the ready port does: the server
// spawns agents, and an env var would be inherited by every one of them and
// by every probe they run, handing the mistake back its permission.
export let alone = async (
  port: number,
  mine: string,
  join = false,
  find = peer,
) => {
  let held = await find(port)
  if (!held) {
    if (join) {
      throw new Error(
        `port ${port} has no predecessor to join; --join belongs only to ` +
          `the dev supervisor's live handoff`,
      )
    }
    return null
  }
  if (!same(mine, held.db)) {
    throw new Error(
      `port ${port} already serves a different graph — ${held.db} ` +
        `(pid ${held.pid}); this process serves ${mine}. Two graphs on one ` +
        `address deal every reader a coin flip, which reads as 'no entity' ` +
        `for rows that exist. Set PORT to a free port, or stop that server.`,
    )
  }
  if (!join) {
    throw new Error(
      `port ${port} already serves this same graph — ${held.db} ` +
        `(pid ${held.pid}). Both servers would answer alike, so nothing ` +
        `would look wrong while every write here landed in that graph. ` +
        `Copy the file and take a free port: cp ${held.db} /tmp/probe.db ` +
        `&& DB_PATH=/tmp/probe.db PORT=5199 deno run -A --unstable-net ` +
        `--unstable-worker-options src/server.ts. (--join is the dev ` +
        `supervisor's word for its own successors, not a way past this.)`,
    )
  }
  // A join is never silent — the one case we allow still says so, because
  // a second listener nobody can see is what made this class expensive.
  console.warn(
    `tasks: joining ${held.db} on port ${port} beside pid ${held.pid}`,
  )
  return held
}

// A normal boot takes the port lock EXCLUSIVELY before asking the address who
// is there. That makes simultaneous empty answers impossible. It returns the
// exclusive lock through the bind; bound() atomically downgrades that same
// descriptor to SHARED for its lifetime. A successor may take a second shared
// lock, and either generation keeps every fresh exclusive boot out across the
// handoff. `alone()` still rejects old servers and strangers predating this.
export let guard = async (
  port: number,
  mine: string,
  join = false,
  find = peer,
) => {
  let file = lock(port)
  if (!file.tryLockSync(!join)) {
    file.close()
    // Preserve the precise, actionable refusal once a peer can answer. In
    // the simultaneous boot window there is no answer yet, so name the claim.
    if (!join) {
      let held = await find(port)
      if (held) await alone(port, mine, false, () => Promise.resolve(held))
    }
    throw new Error(
      `port ${port} is already being claimed by another server; wait for ` +
        `that boot or set PORT to a free port`,
    )
  }
  try {
    await alone(port, mine, join, find)
    return file
  } catch (e) {
    file.close()
    throw e
  }
}

// The listener exists now, so a declared successor may sit beside it. Changing
// the lock on one descriptor is atomic; close-and-reopen would restore the gap.
export let bound = (file: Deno.FsFile) => file.lockSync(false)
