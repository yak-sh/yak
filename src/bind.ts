// One address, one graph, one server. An advisory lock closes the
// check-then-bind gap and stays exclusive for the serving process's lifetime.
//
// Two servers over DIFFERENT files is a coin flip per request, and the loser
// answers `no entity: T-10093` for rows that plainly exist. That reads as a
// deleted task, not as a wrong server, so the graph lies about its contents.
// Two servers over the SAME file is quieter: both answer alike, so nothing ever
// looks wrong. It is refused too; replacement is stop-old then start-new.
//
// Nothing downstream can repair either, so the check belongs before bind.
import { join as pathJoin, resolve } from 'node:path'

// What /graph answers: which file this process serves, and who it is.
export type Serving = { db: string; epoch: string; pid: number }

// Two in-memory graphs share a NAME but no bytes, so ':memory:' never
// matches itself — a test server must never count as an existing peer.
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
// of process exit. Never unlink the empty file: a process may still hold its
// inode, and a fresh path would let the next boot lock a different one.
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
export let alone = async (
  port: number,
  mine: string,
  find = peer,
) => {
  let held = await find(port)
  if (!held) return null
  if (!same(mine, held.db)) {
    throw new Error(
      `port ${port} already serves a different graph — ${held.db} ` +
        `(pid ${held.pid}); this process serves ${mine}. Two graphs on one ` +
        `address deal every reader a coin flip, which reads as 'no entity' ` +
        `for rows that exist. Set PORT to a free port, or stop that server.`,
    )
  }
  throw new Error(
    `port ${port} already serves this same graph — ${held.db} ` +
      `(pid ${held.pid}). Stop that server before starting its replacement. ` +
      `For a probe, copy the file and use a free PORT.`,
  )
}

// A boot takes the port lock exclusively before asking the address who is
// there. That makes simultaneous empty answers impossible, and keeping the
// descriptor alive excludes every second serving process.
export let guard = async (
  port: number,
  mine: string,
  find = peer,
) => {
  let file = lock(port)
  if (!file.tryLockSync(true)) {
    file.close()
    // Preserve the precise, actionable refusal once a peer can answer. In
    // the simultaneous boot window there is no answer yet, so name the claim.
    let held = await find(port)
    if (held) await alone(port, mine, () => Promise.resolve(held))
    throw new Error(
      `port ${port} is already being claimed by another server; wait for ` +
        `that boot or set PORT to a free port`,
    )
  }
  try {
    await alone(port, mine, find)
    return file
  } catch (e) {
    file.close()
    throw e
  }
}
