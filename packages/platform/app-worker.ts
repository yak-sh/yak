/** Wall-clock limits for calls to app workers, in milliseconds. */
export let workerWaits: Record<
  'router' | 'page' | 'service' | 'command',
  number
> = {
  router: 1_000,
  page: 10_000,
  service: 5_000,
  command: 20_000,
}

export class AppWorkerTimeout extends Error {
  constructor(ms: number) {
    super(`The app worker did not answer in ${ms / 1000} seconds.`)
    this.name = 'AppWorkerTimeout'
  }

  response(json = false): Response {
    let init = { status: 504, headers: { 'cache-control': 'no-store' } }
    return json
      ? Response.json(
        { error: { code: 'timeout', message: this.message } },
        init,
      )
      : new Response(this.message, init)
  }
}
