// The run's second Worker, beside the kernel in the one workerd a test run
// starts (probe-suite.ts): it runs any set of modules a test hands it, through
// the runtime's own Worker Loader, so a test of what an app uploads runs its
// bytes without a workerd of its own (probe.ts `script`).
//
//   PUT /__script/<id>          {main, modules}: a module is its source, or
//                               {wasm: <base64>}
//   *   /__script/<id>/<path>   the request, as /<path>, to that set's Worker

let sets = new Map()

let bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer

let loaded = ({ main, modules }) => ({
  compatibilityDate: '2025-05-08',
  mainModule: main,
  modules: Object.fromEntries(
    Object.entries(modules).map(([name, m]) => [
      name,
      typeof m == 'string' ? { js: m } : { wasm: bytes(m.wasm) },
    ]),
  ),
})

export default {
  async fetch(request, env) {
    let url = new URL(request.url)
    let [, , id, ...rest] = url.pathname.split('/')
    if (request.method == 'PUT' && !rest.length) {
      sets.set(id, loaded(await request.json()))
      return new Response(null, { status: 204 })
    }
    let set = sets.get(id)
    if (!set) return new Response(`no script ${id}`, { status: 404 })
    url.pathname = '/' + rest.join('/')
    return env.LOADER.get(id, () => set).getEntrypoint()
      .fetch(new Request(url, request))
  },
}
