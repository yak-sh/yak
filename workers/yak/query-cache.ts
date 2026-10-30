/** A read's bytes belong to its caller and the data revision that answered it. */
export let queryCache = (
  revision: () => unknown,
  read: (request: Request) => Promise<Response>,
) => {
  let version: unknown
  let answers = new Map<string, { body: string; headers: [string, string][] }>()
  return async (request: Request) => {
    let now = revision()
    if (version !== now) {
      answers.clear()
      version = now
    }
    let headers = [...request.headers].filter(([key]) =>
      key != 'idempotency-key'
    )
    let key = JSON.stringify([request.method, request.url, headers])
    let hit = answers.get(key)
    if (hit) return new Response(hit.body, { headers: hit.headers })
    let answer = await read(request)
    if (
      answer.status != 200 ||
      !answer.headers.get('content-type')?.startsWith('application/json')
    ) return answer
    let body = await answer.text()
    if (revision() === now && key.length + body.length <= 64 * 1024) {
      if (answers.size >= 256) answers.delete(answers.keys().next().value!)
      answers.set(key, { body, headers: [...answer.headers] })
    }
    return new Response(body, answer)
  }
}
