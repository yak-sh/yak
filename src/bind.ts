// One address, one graph. `reusePort` turns the public port into an accept
// POOL: any process may join it, and the kernel deals each connection to
// whichever listener it likes. Two servers over the SAME file is the deploy
// handoff — they answer identically, so nobody can tell. Two servers over
// DIFFERENT files is a coin flip per request, and the loser answers
// `no entity: T-10093` for rows that plainly exist. That reads as a deleted
// task, not as a wrong server, so the graph lies about its own contents.
//
// Nothing downstream can repair it: a client has no way to ask which graph
// answered. So the check belongs here, before the join — a server asks the
// address who already serves it, and refuses to sit beside a stranger.
import { resolve } from 'node:path'

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

// Throws rather than exits: a function that kills the process cannot be
// tested, and the caller wants one clean line on stderr, not a stack.
export let alone = async (
  port: number,
  mine: string,
  find = peer,
) => {
  let held = await find(port)
  if (!held || same(mine, held.db)) return held
  throw new Error(
    `port ${port} already serves a different graph — ${held.db} ` +
      `(pid ${held.pid}); this process serves ${mine}. Two graphs on one ` +
      `address deal every reader a coin flip, which reads as 'no entity' ` +
      `for rows that exist. Set PORT to a free port, or stop that server.`,
  )
}
