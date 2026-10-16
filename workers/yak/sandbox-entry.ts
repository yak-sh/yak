// Synchronous runtime exports, with the SDK implementation loaded only by an
// object incarnation or an outbound proxy request. A page uses neither.
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'
import type { Env } from './env.ts'

type Runtime = typeof import('./sandbox-runtime.ts')
type Box = InstanceType<Runtime['Sandbox']>

export class Sandbox extends DurableObject<Env> {
  #ready: Promise<Box>

  constructor(
    ctx: ConstructorParameters<typeof DurableObject<Env>>[0],
    env: Env,
  ) {
    super(ctx, env)
    // The SDK's own constructor also gates its storage initialization. Use the
    // real state, not a wrapper: its container, SQL, alarms and input gates
    // must remain the runtime's. Concurrent first RPCs share this incarnation.
    this.#ready = ctx.blockConcurrencyWhile(async () => {
      let runtime = await import('./sandbox-runtime.ts')
      return new runtime.Sandbox(ctx, env)
    })
  }

  // Workers RPC discovers prototype methods, not functions assigned later on
  // an instance. These are precisely the binding's interface (machine/cloudflare.ts),
  // plus the runtime fetch and alarm callbacks. Run with the SDK as receiver.
  async getState() {
    return (await this.#ready).getState()
  }
  async exec(...args: Parameters<Box['exec']>) {
    return (await this.#ready).exec(...args)
  }
  async listProcesses(...args: Parameters<Box['listProcesses']>) {
    return (await this.#ready).listProcesses(...args)
  }
  async startProcess(...args: Parameters<Box['startProcess']>) {
    return (await this.#ready).startProcess(...args)
  }
  async getProcess(...args: Parameters<Box['getProcess']>) {
    return (await this.#ready).getProcess(...args)
  }
  async killProcess(...args: Parameters<Box['killProcess']>) {
    return (await this.#ready).killProcess(...args)
  }
  async getProcessLogs(...args: Parameters<Box['getProcessLogs']>) {
    return (await this.#ready).getProcessLogs(...args)
  }
  async mkdir(...args: Parameters<Box['mkdir']>) {
    return (await this.#ready).mkdir(...args)
  }
  async writeFile(...args: Parameters<Box['writeFile']>) {
    return (await this.#ready).writeFile(...args)
  }
  async readFile(...args: Parameters<Box['readFile']>) {
    return (await this.#ready).readFile(...args)
  }
  async destroy(...args: Parameters<Box['destroy']>) {
    return (await this.#ready).destroy(...args)
  }
  async setSleepAfter(...args: Parameters<Box['setSleepAfter']>) {
    return (await this.#ready).setSleepAfter(...args)
  }
  async fetch(...args: Parameters<Box['fetch']>) {
    return (await this.#ready).fetch(...args)
  }
  async alarm(...args: Parameters<Box['alarm']>) {
    return (await this.#ready).alarm(...args)
  }
}

export class ContainerProxy extends WorkerEntrypoint {
  declare env: Env
  declare ctx: unknown
  async fetch(req: Request) {
    // This isolate may never have constructed a Sandbox. Loading the same
    // module here registers its outbound handlers before the SDK looks up
    // the class name carried in ctx.props.
    let runtime = await import('./sandbox-runtime.ts')
    // The SDK declarations omit WorkerEntrypoint's runtime constructor.
    let Proxy = runtime.ContainerProxy as unknown as new (
      ctx: unknown,
      env: Env,
    ) => { fetch(req: Request): Promise<Response> }
    return new Proxy(this.ctx, this.env).fetch(req)
  }
}
