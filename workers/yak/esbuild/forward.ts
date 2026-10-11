// The service binding carries a complete compiler job from the kernel.
// Preserve the container's answer, including its out-of-memory refusal.
export let forwarded = async (
  req: Request,
  send: (req: Request) => Promise<Response>,
  catalog: string,
): Promise<Response> => {
  if (req.method != 'POST') {
    return new Response('POST a compiler job', { status: 405 })
  }
  // TODO(T-65018): remove the old ask protocol after the kernel sending jobs
  // is live. The sibling activates first, while the older kernel still serves.
  let body = req.headers.get('x-yak-compiler-job') == '1'
    ? req.body
    : `{"ask":${await req.text()},"catalog":${catalog}}`
  return await send(
    new Request('http://compiler/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  )
}
