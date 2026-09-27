// A bearer and the endpoint it opens. An API key reaches the public API;
// a ChatGPT OAuth token reaches the Codex backend under its account.

/** A bearer and the endpoint it is good for. */
export type Credential = {
  token: string
  /** the ChatGPT account the token was issued to; the Codex backend wants it
   * beside the bearer */
  account?: string
  base: string
}

export let OPENAI = 'https://api.openai.com/v1'
export let CODEX = 'https://chatgpt.com/backend-api/codex'

type Env = (name: string) => string | undefined

/** An API key from the environment. */
export let fromEnv = (env: Env): Credential | undefined => {
  let token = env('OPENAI_API_KEY')?.trim()
  return token ? { token, base: OPENAI } : undefined
}

/** The account claim in a ChatGPT OAuth bearer. The bearer never leaves the
 * caller, and a malformed one fails before it can be sent to the backend. */
export let fromChatGPT = (token: string): Credential => {
  let account: unknown
  try {
    let part = token.split('.')[1]
    let decoded = atob(part.replaceAll('-', '+').replaceAll('_', '/'))
    let claims = JSON.parse(decoded)
    account = claims?.['https://api.openai.com/auth']?.chatgpt_account_id
  } catch { /* A malformed bearer carries no account. */ }
  if (typeof account != 'string' || !account) {
    throw new Error(
      'the ChatGPT sign-in has no account; authorize OpenAI again',
    )
  }
  return { token, account, base: CODEX }
}
