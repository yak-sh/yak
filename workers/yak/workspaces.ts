// Filesystem copies belong to a coordinator without a container. A live
// container's monitor can hold its Durable Object on the preceding Worker
// version; migration therefore uses only the SDK RPCs that version already
// serves. The coordinator keeps the copy receipts and complete erase census.
import { DurableObject } from 'cloudflare:workers'
import { cloudflareProvider } from '@yaks/machine/cloudflare'
import { afterCompiles, copies } from './sandbox-copies.ts'
import { retried } from '@yaks/durable-object'
import type { Env } from './env.ts'
import { TIMEOUT } from './sandbox.ts'
import { r2RawObjects } from './lib/objects.ts'

// A Workers stream with a known byte length, which R2 accepts without
// buffering the archive. It is a runtime global, like WebSocketPair.
declare const FixedLengthStream: {
  new (size: number): TransformStream<Uint8Array, Uint8Array>
}

export type Workspace = {
  fork(source: string, target: string): Promise<string[]>
  retire(): Promise<string[]>
  destroy(): Promise<void>
}
export type Workspaces = {
  idFromName(name: string): unknown
  get(id: unknown): Workspace
}

export class WorkspaceStore extends DurableObject<Env> {
  #copies: ReturnType<typeof copies>
  #prefix: string
  #storage: ConstructorParameters<typeof DurableObject<Env>>[0]['storage']
  #bucket: Env['BLOBS']
  constructor(
    ctx: ConstructorParameters<typeof DurableObject<Env>>[0],
    env: Env,
  ) {
    super(ctx, env)
    this.#storage = ctx.storage
    this.#bucket = env.BLOBS
    this.#prefix = `workspaces/${ctx.id.toString()}/`
    let provider = cloudflareProvider(env.SANDBOX!, { retry: retried })
    this.#copies = copies(
      ctx.storage,
      async () => {
        let ref = { id: (await ctx.storage.get<string>('source'))! }
        if (!await provider.active(ref)) return { processes: [] }
        let processes = await provider.processes(ref)
        let machine = (await provider.wake(ref)).machine
        let waiting = processes.map((p) => ({
          status: p.status,
          waitForExit: async (timeout: number) => {
            // Commands are bounded by TIMEOUT; every look is I/O, and the
            // clock advances while waiting even inside a Durable Object.
            let due = Date.now() + timeout
            while (!(await machine.look(p.id))?.exit) {
              if (Date.now() >= due) {
                throw new Error('sandbox compile did not finish')
              }
              await new Promise((resolve) => setTimeout(resolve, 500))
            }
          },
        }))
        let archive = await afterCompiles(
          waiting,
          TIMEOUT,
          () => provider.archive(ref),
        )
        let id = this.#prefix + crypto.randomUUID()
        try {
          let exact = new FixedLengthStream(archive.size)
          let stop = new AbortController()
          let transfer = archive.body.pipeTo(exact.writable, {
            signal: stop.signal,
          })
          try {
            await Promise.all([env.BLOBS.put(id, exact.readable), transfer])
          } finally {
            stop.abort()
            await transfer.catch(() => {})
          }
          return {
            snapshot: { id, dir: '/workspace' },
            processes: processes.map((p) => p.id),
          }
        } finally {
          await archive.dispose()
        }
      },
      async (name, snapshot) => {
        let object = await env.BLOBS.get(snapshot.id)
        if (!object) return false
        await provider.restore({ id: name }, object.body)
        return true
      },
      async ({ id }) => {
        await env.BLOBS.delete(id)
      },
      (name) => provider.active({ id: name }),
    )
  }
  async fork(source: string, target: string) {
    let was = await this.#storage.get<string>('source')
    if (was && was != source) throw new Error('a workspace has one source')
    if (!was) await this.#storage.put('source', source)
    return await this.#copies.fork(target)
  }
  retire() {
    return this.#copies.retire()
  }
  async destroy() {
    await this.#copies.retire()
    await this.#copies.discard()
    // A crash after upload and before its receipt still leaves bytes under
    // this coordinator's prefix. Erasure takes those too.
    for (
      let key of Object.keys(
        await r2RawObjects(this.#bucket).uploaded(this.#prefix),
      )
    ) {
      await this.#bucket.delete(key)
    }
    await this.#copies.clear()
    await this.#storage.delete('source')
  }
}
