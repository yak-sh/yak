// Where a bearer comes from, and which endpoint it opens. An API key reaches
// the public API; the Codex CLI's OAuth tokens reach the Codex backend under
// the account they were issued to. Nothing here reads a file or the
// environment on its own — both are handed in — so the same code decides for a
// CLI, a server, and a test, and a token is never printed by anything here.
//
// WHICH IS WHY THE EXPIRY CHECK IS NOT HERE. The fleet's doctor watched its
// Codex credential run out (a sign-in nothing but a person can renew, and
// every spawn failing `credential unavailable` until they do) by reading one
// file on one box against that box's clock. That is a deployment's health, not
// this package's concern: which file, which machine, and what to do about it
// all belong to the deployment, and a package that reads neither a file nor the
// environment cannot find out. A deployment that wants the warning implements
// its own `check` (a tool whose verb is `check`, @yaks/tools), where the answer
// is about the machine it runs on.

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

/** Where a Codex `auth.json` may be, most specific first: the tasks server's
 * own copy, then the Codex CLI's. */
export let codexPaths = (env: Env): string[] => {
  let roots = [
    env('TASKS_CODEX_HOME'),
    env('CODEX_HOME'),
    env('XDG_STATE_HOME') && `${env('XDG_STATE_HOME')}/tasks/codex`,
    env('HOME') && `${env('HOME')}/.local/state/tasks/codex`,
    env('HOME') && `${env('HOME')}/.codex`,
  ]
  return roots.filter((r): r is string => !!r).map((r) => `${r}/auth.json`)
}

/** The first credential found: the environment, then the first Codex
 * `auth.json` that `read` can open and that holds one. Throws when there is
 * none. */
export let credential = (
  env: Env,
  read: (path: string) => Promise<string>,
) =>
async (): Promise<Credential> => {
  let key = fromEnv(env)
  if (key) return key
  for (let path of codexPaths(env)) {
    let body: string
    try {
      body = await read(path)
    } catch {
      continue
    }
    let found = fromCodex(body)
    if (found) return found
  }
  throw new Error('no credential: set OPENAI_API_KEY or sign in to Codex')
}
