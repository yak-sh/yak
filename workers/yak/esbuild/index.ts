// yak-esbuild (D-40376): the Worker in front of the compiler. The kernel's
// ESBUILD binding posts it an app's ask, and it posts the compiler's
// container (./Dockerfile, @yaks/esbuild/compile) a job: that ask, with the
// toolkit catalog captured at this deployment beside it. The platform
// supplies the catalog; an app never does. What the container answers is
// what this answers.
//
// One container serves every compile. Releases are rare, so it stays up a
// little after a compile for the next one, then sleeps, and asleep it costs
// nothing. A compile that outgrows its memory is killed with it: the
// container ends mid-request, and this answers 507, which the kernel says as
// a compile too big for the compiler (../esbuild.ts). When the killer takes
// esbuild's process instead, the container answers that 507 itself.
import { Container, getContainer } from '@cloudflare/containers'
import catalog from '../.wrangler/packages.json' with { type: 'json' }

// The compilers' Durable Object namespace, as getContainer takes it.
type Env = { COMPILER: Parameters<typeof getContainer<Compiler>>[0] }

// The catalog as a job carries it, serialized once per isolate.
let CATALOG = JSON.stringify(catalog)

// The exit of a process killed with SIGKILL, which is how the out-of-memory
// killer ends a container that outgrows its memory.
let KILLED = 137

export class Compiler extends Container<Env> {
  override defaultPort = 8080
  // How long the container stays up after its last compile.
  override sleepAfter = '2m'

  override async fetch(req: Request): Promise<Response> {
    try {
      return await this.containerFetch(req)
    } catch (e) {
      if (await this.#exit() != KILLED) throw e
      return new Response(`the compiler's container was killed: ${e}`, {
        status: 507,
      })
    }
  }

  // How the container ended, once its exit is recorded: a request can fail
  // a moment before the runtime reports the exit. Null while it still runs.
  async #exit(): Promise<number | null> {
    for (let tries = 0; tries < 20; tries++) {
      let state = await this.getState()
      if (state.status == 'stopped_with_code') return state.exitCode ?? null
      if (state.status == 'stopped') return 0
      await new Promise((ok) => setTimeout(ok, 100))
    }
    return null
  }
}

export default {
  fetch: async (req: Request, env: Env): Promise<Response> =>
    req.method == 'POST'
      ? await getContainer(env.COMPILER).fetch('http://compiler/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: `{"ask":${await req.text()},"catalog":${CATALOG}}`,
      })
      : new Response('POST an ask', { status: 405 }),
}
