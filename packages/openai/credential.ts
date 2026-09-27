// Where a bearer comes from, and which endpoint it opens. An API key reaches
// the public API; the Codex CLI's OAuth tokens reach the Codex backend under
// the account they were issued to. Nothing here reads a file or the
// environment on its own — both are handed in — so the same code decides for a
// CLI, a server, and a test, and a token is never printed by anything here.
//
// Refresh is the host's work: this package only locates and parses what Codex
// wrote, while the host asks Codex to rotate a rejected token.

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

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

let text = (value: unknown) =>
  typeof value == 'string' && value.trim() ? value.trim() : undefined

/** An API key from the environment. */
export let fromEnv = (env: Env): Credential | undefined => {
  let token = text(env('OPENAI_API_KEY'))
  return token ? { token, base: OPENAI } : undefined
}

/** A Codex CLI `auth.json`: an API key when it holds one, else the OAuth
 * access token and the account it belongs to. `undefined` for anything else,
 * malformed JSON included. */
export let fromCodex = (body: string): Credential | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (!record(parsed)) return undefined
  let key = text(parsed.OPENAI_API_KEY)
  if (key) return { token: key, base: OPENAI }
  let tokens = record(parsed.tokens) ? parsed.tokens : {}
  let token = text(tokens.access_token)
  let account = text(tokens.account_id)
  return token && account ? { token, account, base: CODEX } : undefined
}

/** Where Codex keeps `auth.json`: an explicit home, then the CLI's home.
 * Old task-local copies are not a sign-in: Codex rotates tokens in its own
 * file, so a copy can remain well-shaped long after its token was revoked. */
export let codexPaths = (env: Env): string[] => {
  let roots = [
    env('TASKS_CODEX_HOME'),
    env('CODEX_HOME'),
    env('HOME') && `${env('HOME')}/.codex`,
  ]
  return roots.filter((r): r is string => !!r).map((r) => `${r}/auth.json`)
}

/** The credential and the file Codex will rotate, or the environment's key. */
export let source = async (
  env: Env,
  read: (path: string) => Promise<string>,
): Promise<{ cred: Credential; path?: string }> => {
  let key = fromEnv(env)
  if (key) return { cred: key }
  for (let path of codexPaths(env)) {
    let body: string
    try {
      body = await read(path)
    } catch {
      continue
    }
    let found = fromCodex(body)
    if (found) return { cred: found, path }
  }
  throw new Error('no credential: set OPENAI_API_KEY or sign in to Codex')
}

/** The first credential found, read afresh for every request. */
export let credential = (
  env: Env,
  read: (path: string) => Promise<string>,
) =>
async (): Promise<Credential> => (await source(env, read)).cred
