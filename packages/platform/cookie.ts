// The cookie the platform session rides in, read with no key: the kernel
// (workers/yak lib/token.ts) seals and opens what's in it, yak-front only reads
// its way past one, and `yak admin` sends one it was handed.
export let COOKIE = 'yak_session'

// One cookie's value out of a Cookie header, or null.
export let cookieValue = (header: string | null, name = COOKIE) => {
  for (let part of (header ?? '').split(';')) {
    let [k, ...v] = part.trim().split('=')
    if (k == name) return v.join('=')
  }
  return null
}
