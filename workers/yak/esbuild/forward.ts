// The service binding carries a complete compiler job from the kernel, and
// the container's answer goes back as it came, its out-of-memory refusal
// included. A compile is a pure function of its job, so one the compiler's
// own restart cut short is sent once more, to the compiler that replaced it:
// its container stopped under the compile, its connection was lost before an
// exit was recorded, or the runtime marked its Durable Object reset retryable.
import { timed } from '../../../packages/esbuild/timing.ts'
import { REPLACED } from '../../../packages/esbuild/container.ts'
export { REPLACED }

let retryable = (e: unknown) => (e as { retryable?: boolean })?.retryable

// A Compiler still on the previous deployment answers a lost connection this
// way. Native containers use REPLACED.
let disconnected = async (response: Response): Promise<boolean> =>
  response.status == 500 &&
  await response.clone().text() == 'Container suddenly disconnected, try again'

export let forwarded = async (
  req: Request,
  send: (req: Request, retry: boolean) => Promise<Response>,
): Promise<Response> => {
  if (req.method != 'POST') {
    return new Response('POST a compiler job', { status: 405 })
  }
  if (req.headers.get('x-yak-compiler-job') != '1') {
    return new Response('unsupported compiler job protocol', { status: 400 })
  }
  let job = await req.text()
  let sent = (retry: boolean) =>
    send(
      new Request('http://compiler/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: job,
      }),
      retry,
    )
  let began = Date.now()
  try {
    let answer = await sent(false)
    if (answer.status != REPLACED && !await disconnected(answer)) return answer
    await answer.body?.cancel()
  } catch (e) {
    if (!retryable(e)) throw e
  }
  let retry = Date.now() - began
  return timed(await sent(true), { retry })
}
