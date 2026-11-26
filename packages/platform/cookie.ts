// The cookie the platform session rides in, read with no key: the kernel
// (workers/yak lib/token.ts) seals and opens what's in it, yak-front only reads
// its way past one, and `yak admin` sends one it was handed.
export let COOKIE = 'yak_session'
export let HOST_COOKIE = '__Host-yak_session'

// One cookie's value out of a Cookie header, or null.
export let cookieValue = (
  header: string | null,
  name = COOKIE,
): string | null => {
  for (let part of (header ?? '').split(';')) {
    let [k, ...v] = part.trim().split('=')
    if (k == name) return v.join('=')
  }
  return null
}

/** What a press answered, said once on the page it lands on: `no` when it is
 * why the press did not work. */
export type Said = { say: string; no?: boolean }

/** The cookie a press's answer rides in across the one navigation after it,
 * so the address never carries it and a reload never says it again. */
export let SAID = 'yak_said'

/// let res = new Response()
/// telling(res, { say: 'Saved.' }, '/manage').headers.get('set-cookie')
///   -> 'yak_said=%7B%22say%22%3A%22Saved.%22%7D; Path=/manage; Max-Age=60; Secure; HttpOnly; SameSite=Lax'
/** `res`, carrying `said` to the next page drawn under `path`. */
export let telling = (res: Response, said: Said, path = '/'): Response => {
  res.headers.append(
    'set-cookie',
    `${SAID}=${
      encodeURIComponent(JSON.stringify(said))
    }; Path=${path}; Max-Age=60; Secure; HttpOnly; SameSite=Lax`,
  )
  return res
}

/// heard('a=1; yak_said=%7B%22say%22%3A%22Saved.%22%7D') -> { say: 'Saved.' }
/// heard('yak_said=garbled') -> null
/// heard(null) -> null
/** What a press carried here (`telling`), or null. */
export let heard = (header: string | null): Said | null => {
  let value = cookieValue(header, SAID)
  if (!value) return null
  try {
    let said = JSON.parse(decodeURIComponent(value))
    return typeof said?.say == 'string'
      ? { say: said.say, ...said.no ? { no: true } : {} }
      : null
  } catch {
    return null
  }
}

/** `res`, with what was carried to it (`telling`) spent, so it is said once. */
export let unsaid = (res: Response, path = '/'): Response => {
  res.headers.append(
    'set-cookie',
    `${SAID}=; Path=${path}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`,
  )
  return res
}
