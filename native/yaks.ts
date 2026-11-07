// What the shell asks of yaks.app, through the doors a browser uses: the
// sign-in card's two posts, which leave the platform's session cookie in the
// phone's cookie store (every web view shares it), and the connector's tools at
// `/mcp`; an app's own store is @yaks/native/remote's.
export let APEX = 'https://yaks.app'

/** One app of a space, as `app_list` answers it. */
export type App = { slug: string; title: string; url: string; access: string }

/** A space and its apps. */
export type Space = { slug: string; title: string; role: string; apps: App[] }

/** Nobody is signed in on this phone, or the session ran out. */
export class SignedOut extends Error {}

let form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

/** Ask for a sign-in code sent to an email address or a US mobile number. */
export let ask = async (address: string) => {
  let r = await fetch(`${APEX}/login`, form({ address }))
  if (!r.ok) throw new Error('That address could not be sent a code.')
}

/** Spend the code: the answer sets the session cookie. */
export let spend = async (address: string, code: string) => {
  await fetch(`${APEX}/login/code`, form({ address, code }))
  await spaces()
}

/** Call one of the connector's tools as the signed-in person; its answer's
 * value. */
export let tool = async <T>(name: string, args: object = {}): Promise<T> => {
  let r = await fetch(`${APEX}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (r.status == 401) throw new SignedOut()
  let { result, error } = await r.json()
  if (error || result?.isError) {
    throw new Error(error?.message ?? result?.content?.[0]?.text)
  }
  let said = result.structuredContent?.result as { output?: { value: T } }[]
  return said.find((b) => b.output)!.output!.value
}

/** Every space the person is in, with its apps. */
export let spaces = async () =>
  (await tool<{ spaces: Space[] }>('app_list')).spaces
