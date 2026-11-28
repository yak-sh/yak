// yak-esbuild (D-40376): the Worker in front of the compiler. The kernel's
// ESBUILD binding posts it an app's ask, and it posts the compiler's
// container (./Dockerfile, @yaks/esbuild/compile) a job: that ask, with the
// toolkit catalog captured by that kernel deployment beside it. The platform
// supplies the catalog; an app never does. What the container answers is
// what this answers.
//
// The runtime keeps the container warm while the Durable Object sleeps. A
// compile cut short by a container replacement is sent again (./forward.ts).
//
// It also strips TypeScript and JSX to JavaScript for the kernel, here in the
// Worker with no container woken: the kernel's module walk and code mode
// call `strip` over the binding, so sucrase is in this upload and not the
// kernel's, whose every isolate compiles all it uploads (../esbuild.ts
// `stripping`, T-133988).
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'
import { strip } from '@yaks/esbuild/strip'
import { forwarded } from './forward.ts'
import { compiler } from '../../../packages/esbuild/container.ts'

type Env = { COMPILER: DurableObjectNamespace<Compiler> }

export class Compiler extends DurableObject<Env> {
  #compile = compiler(this.ctx.container!)

  override fetch(request: Request): Promise<Response> {
    return this.#compile(request)
  }

  // Consume the last alarm from a deployment that used the Containers SDK.
  override alarm() {}
}

export default class extends WorkerEntrypoint {
  // The runtime sets this; `declare` names its type without a field.
  declare env: Env

  override fetch(req: Request): Promise<Response> {
    return forwarded(
      req,
      (job, retry) =>
        this.env.COMPILER.getByName(
          retry ? 'replacement' : 'cf-singleton-container',
        )
          .fetch(job),
    )
  }

  strip(path: string, source: string): string | Promise<string> {
    return strip(path, source)
  }
}
