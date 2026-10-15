// yak-esbuild (D-40376): the Worker in front of the compiler. The kernel's
// ESBUILD binding posts it an app's ask, and it posts the compiler's
// container (./Dockerfile, @yaks/esbuild/compile) a job: that ask, with the
// toolkit catalog captured by that kernel deployment beside it. The platform
// supplies the catalog; an app never does. What the container answers is
// what this answers.
//
// One container serves every compile. Releases are rare, so it stays up a
// little after a compile for the next one, then sleeps, and asleep it costs
// nothing. A compile that outgrows its memory is killed with it: the
// container ends mid-request, and this answers 507, which the kernel says as
// a compile too big for the compiler (../esbuild.ts). When the killer takes
// esbuild's process instead, the container answers that 507 itself. When the
// container stops under a compile for any other reason, a new version's
// rollout replacing it most often, the compile was sound: this answers
// REPLACED, and the door sends the job again (./forward.ts).
import { Container, getContainer } from '@cloudflare/containers'
import { forwarded, REPLACED } from './forward.ts'

// The compilers' Durable Object namespace, as getContainer takes it.
type Env = { COMPILER: Parameters<typeof getContainer<Compiler>>[0] }

// The exit of a process killed with SIGKILL, which is how the out-of-memory
// killer ends a container that outgrows its memory.
let KILLED = 137
// What the container answers when esbuild's process ended under a compile
// (@yaks/esbuild/compile), and what this answers for a compile that outgrew
// its memory.
let OUTGREW = 507

export class Compiler extends Container<Env> {
  override defaultPort = 8080
  // How long the container stays up after its last compile.
  override sleepAfter = '2m'

  // esbuild's process ending, or the container's, is the compile's own
  // memory only while the container runs on or was killed; a container that
  // stopped otherwise was stopped under it.
  override async fetch(req: Request): Promise<Response> {
    let answer: Response | undefined
    let error: unknown
    try {
      answer = await this.containerFetch(req)
      if (answer.status != OUTGREW) return answer
    } catch (e) {
      error = e
    }
    let exit = await this.#exit()
    if (exit == KILLED) {
      return new Response(
        `the compiler's container was killed: ${
          answer ? await answer.text() : error
        }`,
        { status: OUTGREW },
      )
    }
    if (exit != null) {
      return new Response(
        `the compiler's container stopped under the compile, exit ${exit}`,
        { status: REPLACED },
      )
    }
    if (answer) return answer
    throw error
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
    await forwarded(req, (job) => getContainer(env.COMPILER).fetch(job)),
}
