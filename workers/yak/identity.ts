// The identity part (D-32318 §Auth): sign-in and the OAuth provider at the
// apex — `/login` and `/oauth/*`. T-32327 fills this handler in: email-code
// sign-in, workers-oauth-provider for agents, a person and their first
// membership written to the directory, the yak_session cookie minted with
// src/token.ts `sign` and set with `cookie`. Until then every door answers
// with a soft page. Verifying a session is not here: that is session.ts, a
// pure library every part may call with the secret in hand.
import type { Env } from './env.ts'
import { soon } from './pages.ts'

export let fetch = (_req: Request, _env: Env): Promise<Response> =>
  Promise.resolve(soon('Sign-in'))
