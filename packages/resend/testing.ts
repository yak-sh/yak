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

/** A domain the stand-in Domains API holds, in Resend's own shape. */
export type HeldDomain = {
  id: string
  name: string
  status: string
  capabilities: { sending: string; receiving: string }
  records: {
    record: string
    type: string
    name: string
    value: string
    priority?: number
    status: string
  }[]
}

/** A stand-in for Resend's Domains API, answering a `full_access` key as
 * `token` and refusing any other the way Resend refuses a sending key. Its
 * records are named relative to the zone, the domain's last two labels, as
 * Resend names them; `arrive` marks a domain's records found in DNS. */
export let domainsApi = (token = 'full-access') => {
  let held = new Map<string, HeldDomain>()
  let calls: string[] = []
  let refuse = (status: number, name: string, message: string) =>
    Response.json({ statusCode: status, name, message }, { status })
  let records = (name: string, receiving: boolean) => {
    let lead = name.split('.').slice(0, -2).join('.')
    let at = (label: string) => lead ? `${label}.${lead}` : label
    let one = (record: string, type: string, name: string, value: string) => ({
      record,
      type,
      name,
      value,
      ttl: 'Auto',
      status: 'not_started',
    })
    return [
      one('DKIM', 'TXT', at('resend._domainkey'), 'p=MIGfMA0GCSq'),
      {
        ...one(
          'SPF',
          'MX',
          at('send'),
          'feedback-smtp.us-east-1.amazonses.com',
        ),
        priority: 10,
      },
      one('SPF', 'TXT', at('send'), 'v=spf1 include:amazonses.com ~all'),
      one('SPF', 'CNAME', at('rsend'), 'send.forge.rmta.net'),
      ...(receiving
        ? [{
          ...one('Receiving', 'MX', lead || '@', 'receive.forge.rmta.net'),
          priority: 10,
        }]
        : []),
    ]
  }
  let answer = (url: string, init: RequestInit): Response => {
    let { pathname } = new URL(url), method = init.method ?? 'GET'
    calls.push(`${method} ${pathname}`)
    if (new Headers(init.headers).get('authorization') != `Bearer ${token}`) {
      return refuse(
        401,
        'restricted_api_key',
        'This API key is restricted to only send emails',
      )
    }
    let body = init.body ? JSON.parse(String(init.body)) : {}
    let [, , id, verb] = pathname.split('/')
    let domain = id ? held.get(id) : undefined
    if (pathname == '/domains' && method == 'GET') {
      return Response.json({
        object: 'list',
        has_more: false,
        data: [...held.values()].map(({ records: _, ...d }) => d),
      })
    }
    if (pathname == '/domains' && method == 'POST') {
      if ([...held.values()].some((d) => d.name == body.name)) {
        return refuse(
          403,
          'validation_error',
          `The domain ${body.name} is already registered`,
        )
      }
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(body.name ?? '')) {
        return refuse(422, 'validation_error', `The \`name\` field is invalid`)
      }
      let capabilities = {
        sending: 'enabled',
        receiving: 'disabled',
        ...body.capabilities,
      }
      let made: HeldDomain = {
        id: crypto.randomUUID(),
        name: body.name,
        status: 'not_started',
        capabilities,
        records: records(body.name, capabilities.receiving == 'enabled'),
      }
      held.set(made.id, made)
      return Response.json({ object: 'domain', ...made })
    }
    if (!domain) return refuse(404, 'not_found', 'Domain not found')
    if (!verb && method == 'GET') {
      return Response.json({ object: 'domain', ...domain })
    }
    if (!verb && method == 'PATCH') {
      domain.capabilities = { ...domain.capabilities, ...body.capabilities }
      domain.records = records(
        domain.name,
        domain.capabilities.receiving == 'enabled',
      )
      return Response.json({ object: 'domain', id: domain.id })
    }
    if (!verb && method == 'DELETE') {
      held.delete(domain.id)
      return Response.json({ object: 'domain', id: domain.id, deleted: true })
    }
    if (verb == 'verify' && method == 'POST') {
      for (let r of domain.records) {
        if (r.status != 'verified') r.status = 'pending'
      }
      domain.status = 'pending'
      return Response.json({ object: 'domain', id: domain.id })
    }
    return refuse(405, 'method_not_allowed', 'Method not allowed')
  }
  let fetch = (url: string, init: RequestInit = {}) =>
    Promise.resolve(answer(url, init))
  let arrive = (name: string) => {
    for (let d of held.values()) {
      if (d.name != name) continue
      for (let r of d.records) r.status = 'verified'
      d.status = 'verified'
    }
  }
  return { fetch, held, calls, arrive }
}
