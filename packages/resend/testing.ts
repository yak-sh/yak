// A webhook fixture signed at the same boundary Resend uses.
export let webhook = async (
  body: unknown,
  secret: string,
): Promise<Request> => {
  let raw = JSON.stringify(body), at = String(Math.floor(Date.now() / 1000))
  let key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(
      atob(secret.replace(/^whsec_/, '')),
      (c) => c.charCodeAt(0),
    ),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  let signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`fixture.${at}.${raw}`),
  )
  return new Request('https://mail.example/mail/resend', {
    method: 'POST',
    body: raw,
    headers: {
      'svix-id': 'fixture',
      'svix-timestamp': at,
      'svix-signature': 'v1,' +
        btoa(String.fromCharCode(...new Uint8Array(signature))),
    },
  })
}
