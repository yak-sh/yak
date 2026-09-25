// The client's side of `Server-Timing`: a `fetch` that says one line per
// response, with the numbers the server sent, for `yak --timing` and for any
// other program that wants to see where a request's time went.

/** A `fetch` that prints one line per response:
 *
 *     POST /mcp 200  door;dur=12, hops;dur=3, total;dur=41
 *
 * The numbers are the server's own `Server-Timing` header (yaks.app writes it
 * in workers/yak/timing.ts), printed exactly as they arrived, so this line and
 * a `curl -i` agree. A server that sends no such header still gets a line. */
export let timed = (
  say: (line: string) => void,
  go: (request: Request) => Response | Promise<Response> = (r) => fetch(r),
) =>
async (request: Request): Promise<Response> => {
  let res = await go(request)
  let at = new URL(request.url)
  let entries = res.headers.get('server-timing')
  say(
    `${request.method} ${at.pathname}${at.search} ${res.status}${
      entries ? `  ${entries}` : ''
    }`,
  )
  return res
}
