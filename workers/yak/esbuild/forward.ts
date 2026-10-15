// The service binding carries a complete compiler job from the kernel, and
// the container's answer goes back as it came, its out-of-memory refusal
// included. A compile is a pure function of its job, so one the compiler's
// own restart cut short is sent once more, to the compiler that replaced it:
// its container stopped under the compile (REPLACED, ./index.ts), or its
// Durable Object was reset for a new version (an error the runtime marks
// retryable). Every rollout of this Worker does both to a compile in flight.

/** What the compiler answers when its container stopped under a compile for
 * a reason other than the compile's own memory. */
export let REPLACED = 503

let retryable = (e: unknown) => (e as { retryable?: boolean })?.retryable

export let forwarded = async (
  req: Request,
  send: (req: Request) => Promise<Response>,
): Promise<Response> => {
  if (req.method != 'POST') {
    return new Response('POST a compiler job', { status: 405 })
  }
  if (req.headers.get('x-yak-compiler-job') != '1') {
    return new Response('unsupported compiler job protocol', { status: 400 })
  }
  let job = await req.text()
  let sent = () =>
    send(
      new Request('http://compiler/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: job,
      }),
    )
  try {
    let answer = await sent()
    if (answer.status != REPLACED) return answer
  } catch (e) {
    if (!retryable(e)) throw e
  }
  return await sent()
}
