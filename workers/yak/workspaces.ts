// Filesystem copies belong to a coordinator without a container. A live
// container's monitor can hold its Durable Object on the preceding Worker
// version; migration therefore uses only the SDK RPCs that version already
// serves. The coordinator keeps the copy receipts and complete erase census.
import { cloudflareProvider } from '@yaks/sandbox/cloudflare'
import { afterCompiles, copies } from './sandbox-copies.ts'
import { retried } from '@yaks/durable-object/resets'
import { Durable, type State } from '@yaks/durable-object/object'
import { caught } from './defects.ts'
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

// An object that holds no graph: its source and copy receipts are its keys,
// and its archives are in R2. Each RPC method is an entry of its own.
export class WorkspaceStore extends Durable {
  #copies: ReturnType<typeof copies>
  #prefix: string
  #bucket: Env['BLOBS']
  constructor(ctx: State & { id: { toString(): string } }, env: Env) {
    super(ctx, {
      report: (e, entry) => caught(e, { request: `workspaces ${entry}` }),
    })
    let storage = this.keys
    this.#bucket = env.BLOBS
    this.#prefix = `workspaces/${ctx.id.toString()}/`
    let provider = cloudflareProvider(env.WORKBENCH!, {
      legacyRecreation: true,
      retry: retried,
    })
    this.#copies = copies(
      storage,
      async () => {
        let ref = { id: (await storage.get<string>('source'))! }
        if (!await provider.active(ref)) return { processes: [] }
        let processes = await provider.processes(ref)
        let machine = (await provider.connect(ref)).workspace
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
        let object = await r2RawObjects(env.BLOBS).open(snapshot.id)
        if (!object) return false
        await provider.restore({ id: name }, await object.read())
        return true
      },
      async ({ id }) => {
        await r2RawObjects(env.BLOBS).delete(id)
      },
      (name) => provider.active({ id: name }),
    )
  }
  fork(source: string, target: string): Promise<string[]> {
    return this.enter('fork', async () => {
      let was = await this.keys.get<string>('source')
      if (was && was != source) throw new Error('a workspace has one source')
      if (!was) await this.keys.put('source', source)
      return await this.#copies.fork(target)
    })
  }
  retire(): Promise<string[]> {
    return this.enter('retire', () => this.#copies.retire())
  }
  destroy(): Promise<void> {
    return this.enter('destroy', () => this.#destroy())
  }
  async #destroy() {
    await this.#copies.retire()
    await this.#copies.discard()
    // A crash after upload and before its receipt still leaves bytes under
    // this coordinator's prefix. Erasure takes those too.
    for (
      let key of Object.keys(
        await r2RawObjects(this.#bucket).uploaded(this.#prefix),
      )
    ) {
      await r2RawObjects(this.#bucket).delete(key)
    }
    await this.#copies.clear()
    await this.keys.delete('source')
  }
}
