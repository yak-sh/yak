// One app worker beside an isolated HTTP kernel. Dispatch runs the source
// entry through the shipped shim, whose doors spend the vouched grants.
import { SHIM } from './dispatch.ts'
import { fresh, type Kernel } from './probe.ts'

export let workerKernel = async (source: URL): Promise<Kernel> => {
  let dir = Deno.makeTempDirSync({ prefix: 'yak-worker-probe-' })
  try {
    Deno.writeTextFileSync(`${dir}/entry.js`, SHIM)
    Deno.writeTextFileSync(
      `${dir}/worker.js`,
      `export { default } from ${JSON.stringify(source.href)}`,
    )
    let { default: worker } = await import(`file://${dir}/entry.js`)
    let k = await fresh({
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
          Deno.removeSync(dir, { recursive: true })
        }
      },
    }
  } catch (e) {
    Deno.removeSync(dir, { recursive: true })
    throw e
  }
}
