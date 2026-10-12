// Wrangler's API boundary. Reads and preparation reach Cloudflare directly;
// requests that activate a Worker carry the deployment the ancestry check saw
// to the shared activation gate. A conflict owes a fresh read and decision.
import { activationPath, current } from './activation.ts'

let API = 'https://api.cloudflare.com/client/v4'
let error = (message: string, status = 409) =>
  Response.json({ success: false, errors: [{ message }] }, { status })
let reply = (response: Response) => {
  let headers = new Headers(response.headers)
  // Fetch has decoded the upstream body; the local HTTP response frames it
  // again. Its compressed length and encoding must not reach Wrangler.
  for (
    let name of [
      'content-encoding',
      'content-length',
      'transfer-encoding',
      'connection',
    ]
  ) {
    headers.delete(name)
  }
  return new Response(response.body, { status: response.status, headers })
}

export let activationClient = (
  account: string,
  head: string,
  inspect: (commits: string[]) => Promise<string | null>,
  ask: typeof fetch = fetch,
  gate = 'https://yaks.app/_activate',
) => {
  let skipped = false
  return {
    get skipped() {
      return skipped
    },
    async fetch(request: Request): Promise<Response> {
      let url = new URL(request.url)
      let path = url.pathname.replace(/^\/client\/v4/, '')
      let target = `${API}${path}${url.search}`
      let activating = request.method == 'PUT' &&
          /^\/accounts\/[^/]+\/workers\/scripts\/[^/]+$/.test(path) ||
        request.method == 'POST' && path.endsWith('/deployments')
      if (!activating) {
        let headers = new Headers(request.headers)
        for (
          let name of [
            'host',
            'connection',
            'content-length',
            'transfer-encoding',
          ]
        ) {
          headers.delete(name)
        }
        return reply(
          await ask(
            new Request(target, {
              method: request.method,
              headers,
              body: request.body,
              redirect: 'error',
            }),
          ),
        )
      }
      if (!activationPath(request.method, path, account)) {
        return error('Refused an activation outside the platform Workers', 400)
      }
      let headers = new Headers()
      for (let name of ['authorization', 'content-type']) {
        let value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
      let body = await request.arrayBuffer()
      for (let attempt = 0; attempt < 3; attempt++) {
        let live = await current(path, headers, ask)
        let why = await inspect(live.commits)
        if (why) {
          skipped = true
          console.log(`not activating: ${why}`)
          return error(`Superseded build: ${why}`)
        }
        headers.set('x-yak-activation-path', path + url.search)
        headers.set('x-yak-deployment', live.id)
        headers.set('x-yak-commit', head)
        let response = await ask(gate, {
          method: request.method,
          headers,
          body,
          redirect: 'error',
        })
        if (response.headers.get('x-yak-activation-conflict') != '1') {
          return reply(response)
        }
        await response.body?.cancel()
      }
      return error('Serving deployment kept changing; refusing activation')
    },
  }
}
