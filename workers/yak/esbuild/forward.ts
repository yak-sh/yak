// The service binding carries a complete compiler job from the kernel.
// Preserve the container's answer, including its out-of-memory refusal.
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
  return await send(
    new Request('http://compiler/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: req.body,
    }),
  )
}
