// One app worker beside an isolated HTTP kernel. Dispatch runs the source
// entry through the shipped shim, whose doors spend the vouched grants.
import * as io from '@yaks/file/io'
import { SHIM } from './dispatch.ts'
import { fresh, type Kernel } from './probe.ts'
import type { Vars } from './env.ts'

// The server source a release needs to build a worker at all: a page asks
// the dispatch namespace only for a release that built one. The namespace
// below runs the source the kernel was given in its place.
export let serverSource = {
  path: 'worker.js',
  content:
    'export default { fetch: () => new Response(null, { status: 404 }) }',
}

/** A kernel whose apps' workers all run `source`, with `bindings` beside the
 * kernel's own. */
export let workerKernel = async (
  source: URL,
  bindings: Vars = {},
): Promise<Kernel> => {
  let dir = io.makeTempDirSync({ prefix: 'yak-worker-probe-' })
  try {
    io.writeTextFileSync(`${dir}/entry.js`, SHIM)
    io.writeTextFileSync(
      `${dir}/worker.js`,
      `export { default } from ${JSON.stringify(source.href)}`,
    )
    let { default: worker } = await import(`file://${dir}/entry.js`)
    let k = await fresh({
      ...bindings,
      DISPATCH: {
        get: () => ({
          fetch: (req: Request) =>
            worker.fetch(req, {
              KERNEL: {
                fetch: (asked: Request) => {
                  let url = new URL(asked.url)
                  return k.at(url.hostname, url.pathname + url.search, {
                    method: asked.method,
                    headers: Object.fromEntries(asked.headers),
                    body: asked.body,
                  })
                },
              },
            }, {}),
        }),
      },
    })
    return {
      ...k,
      stop: async () => {
        try {
          await k.stop()
        } finally {
          io.removeSync(dir, { recursive: true })
        }
      },
    }
  } catch (e) {
    io.removeSync(dir, { recursive: true })
    throw e
  }
}
