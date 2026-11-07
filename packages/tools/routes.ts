// A declared tool at an HTTP door. The host resolves the tool and caller;
// this reads the invocation and answers its result or expected refusal.
import { parsed } from './args.ts'
import { CallError, refused } from './errors.ts'

type Handler = (request: Request) => Response | Promise<Response>
type Route = { method: string; path: string; handle: Handler }
let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

/** POST `{name,args}` to one caller-scoped command runner. */
let command = (
  run: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Handler =>
async (req) => {
  if (req.method != 'POST') {
    return Response.json({
      error: { code: 'method_not_allowed', message: 'command takes POST' },
    }, { status: 405 })
  }
  try {
    let body: unknown = await req.json().catch(() => {
      throw new CallError('arguments', 'command body must be JSON')
    })
    if (!object(body)) {
      throw new CallError('arguments', 'command body must be an object')
    }
    if (typeof body.name != 'string' || !body.name) {
      throw new CallError('arguments', 'command needs a name')
    }
    let out = await run(body.name, parsed(body.args))
    return Response.json({ ...out, ok: true })
  } catch (e) {
    return refused(e)
  }
}

/** One HTTP route for a host that offers declared command invocation. */
export let routes = (host: {
  command?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
}): Route[] =>
  host.command
    ? [{ method: 'POST', path: '/command', handle: command(host.command) }]
    : []
