// Where a client on this machine finds the server a config serves, exported
// as `@yaks/api/address`. It imports nothing, so a client that only needs the
// address (a `yak` command asking the running server, @yaks/cli ./warm.ts)
// loads none of the server.

/** The port `serve` listens on when neither the call nor the config names
 * one. */
export let PORT = 8787

/** The interface `serve` binds when neither the call nor the config names
 * one: this machine alone. A server that answers every request as the machine
 * itself (@yaks/cli's `doorman`) is offered to a network only when a config
 * says so. */
export let HOSTNAME = '127.0.0.1'

/** The header a request names the graph file it means in: a server serving
 * another answers it 421 and runs nothing (./tools.ts), so a command whose
 * config shares a port with another graph's never reaches that graph. */
export let DB = 'x-yak-db'

/** Where a client on this machine reaches the server a config serves: its
 * port, else {@link PORT}, at its hostname, or this machine's own address
 * where it names none or every interface.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { served } from '@yaks/api/address'
 *
 * assertEquals(served({}), 'http://127.0.0.1:8787')
 * assertEquals(
 *   served({ port: 5173, hostname: '0.0.0.0' }),
 *   'http://127.0.0.1:5173',
 * )
 * ```
 */
export let served = (
  config: { port?: number; hostname?: string },
): string => {
  let { hostname = HOSTNAME, port = PORT } = config
  let any = ['0.0.0.0', '::', '[::]'].includes(hostname)
  return `http://${any ? HOSTNAME : hostname}:${port}`
}
