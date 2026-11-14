// What every call to Resend's API shares: its root, and the code and message
// of a refusal, which callers keep apart because a body can echo a private
// letter or credential.

/** The HTTP boundary a host supplies in place of `fetch`. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** The API root, `https://api.resend.com` unless `base` names another. */
export let root = (base?: string): string =>
  (base ?? 'https://api.resend.com').replace(/\/+$/, '')

/** Resend's error body, `{name, message}`, or empty strings where it has
 * none. `name` is only ever Resend's snake_case code. */
export let said = (
  response: Response,
): Promise<{ name: string; message: string }> =>
  response.ok ? Promise.resolve({ name: '', message: '' }) : response.json()
    .then(
      (body: unknown) => {
        let { name, message } = (body ?? {}) as Record<string, unknown>
        return {
          name: typeof name == 'string' && /^[a-z_]+$/.test(name) ? name : '',
          message: typeof message == 'string' ? message : '',
        }
      },
      () => ({ name: '', message: '' }),
    )
