let PROJECT = /^proj_[A-Za-z0-9_-]{1,120}$/

export let projectId = (value: unknown): value is string =>
  typeof value == 'string' && PROJECT.test(value)

/** Issue a project credential through its own service account. OpenAI
 * returns the key only on creation. Provider responses stay at this boundary. */
export let projectKey = async (
  admin: string,
  project: string,
  name: string,
  send: typeof fetch = fetch,
): Promise<string> => {
  if (!projectId(project)) throw new Error('Invalid OpenAI project ID')
  let url =
    `https://api.openai.com/v1/organization/projects/${project}/service_accounts`
  let response = await send(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${admin}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name }),
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {
    throw new Error('OpenAI project credential request failed')
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `OpenAI project credential request returned ${response.status}`,
    )
  }
  let body = await response.json().catch(() => null) as {
    api_key?: { value?: unknown }
  } | null
  let key = body?.api_key?.value
  if (typeof key != 'string' || !key.startsWith('sk-')) {
    throw new Error('OpenAI did not issue a project credential')
  }
  return key
}
