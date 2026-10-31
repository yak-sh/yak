/** Form waits through the isolated kernel; resets never belong in a timed act.
 * Importing this module starts no kernel, creates no fixture, and calls no API.
 * Hosted payment and OAuth URLs are inspected, never followed. */
import { d1 } from '../packages/d1/testing.ts'
import type { Env } from '../workers/yak/env.ts'
import {
  allowed,
  connector,
  type Kernel,
  letters,
  meta,
  onPlus,
} from '../workers/yak/probe.ts'

export type Operation = {
  prepare?: () => Promise<unknown>
  act: () => Promise<unknown>
}
export const FORMS = [
  'form/settings-name',
  'form/settings-space',
  'form/restore',
  'form/people-resend',
  'form/connections-add',
  'form/connections-signin',
  'form/connections-key',
  'form/connections-disconnect',
  'form/connections-attach',
  'form/connections-open',
  'form/connections-close',
  'form/selling-start',
  'form/app-new-upload',
  'form/app-update-upload',
  'form/selling-stop',
  'form/billing-checkout',
  'form/billing-portal',
  'form/agent-disconnect',
] as const

const KEY = 'sk_test_local_platform_waits_not_a_credential'
const CUSTOMER = 'cus_local_platform_waits'
const CHECKOUT = 'https://checkout.stripe.com/c/pay/local-platform-waits'
const PORTAL = 'https://billing.stripe.com/p/session/local-platform-waits'
/** Dummy flags only. The caller's global fetch guard is mandatory. */
let vault: ReturnType<typeof d1> | undefined
export const bindings: Partial<Env> = {
  get VAULT() {
    return (vault ??= d1()) as unknown as NonNullable<Env['VAULT']>
  },
  VAULT_KEY: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  STRIPE_KEY: KEY,
  STRIPE_PRICE: 'price_local_platform_waits',
}

/** An exact allowlist, not a general Stripe mock. Unknown requests stay denied
 * by the caller. All responses are local and no returned hosted URL is fetched. */
export const external = (
  input: Request,
  init?: RequestInit,
): Response | undefined => {
  const req = init ? new Request(input, init) : input
  const u = new URL(req.url)
  if (
    u.origin != 'https://api.stripe.com' || u.search ||
    req.method != 'POST' || req.headers.get('authorization') != `Bearer ${KEY}`
  ) return undefined
  switch (u.pathname) {
    case '/v1/accounts':
      return Response.json({
        id: 'acct_local_platform_waits',
        charges_enabled: true,
        details_submitted: true,
      })
    case '/v1/account_links':
      return Response.json({
        url: 'https://connect.stripe.com/setup/local-platform-waits',
      })
    case '/v1/customers':
      return Response.json({ id: CUSTOMER })
    case '/v1/checkout/sessions':
      return Response.json({ id: 'cs_local_platform_waits', url: CHECKOUT })
    case '/v1/billing_portal/sessions':
      return Response.json({ id: 'bps_local_platform_waits', url: PORTAL })
    default:
      return undefined
  }
}

const insist: (yes: unknown, message: string) => asserts yes = (
  yes,
  message,
) => {
  if (!yes) throw new Error(`platform forms: ${message}`)
}

export const forms = async (
  k: Kernel,
  _scratch: string,
): Promise<Record<string, Operation>> => {
  const agent = connector(k, k.owner.cookie)
  const dir = meta(k)
  const space = 'bench-forms'
  const seller = 'bench-forms-seller'
  await agent.tool('space_new', {
    slug: seller,
    title: 'Seller form benchmark',
  })
  await onPlus(
    k,
    String((await dir.query(`.space.slug=${seller}`))[0].entity.eid),
  )
  const moving = ['bench-forms-moving-a', 'bench-forms-moving-b']
  await agent.tool('space_new', { slug: space, title: 'Form benchmark' })
  await agent.tool('space_new', { slug: moving[0], title: 'Rename benchmark' })
  await agent.tool('app_new', {
    space,
    slug: 'restored',
    title: 'Restore fixture',
  })
  await agent.tool('app_new', {
    space,
    slug: 'connected',
    title: 'Connected form app',
  })
  const rows = await dir.query(`.space.slug=${space} *`)
  const eid = String(rows[0].entity.eid)
  const path = (view: string, slug = space) =>
    `/manage${view ? '/' + view : ''}?space=${slug}`
  const headers = {
    cookie: k.owner.cookie,
    origin: `https://${k.host}`,
    'content-type': 'application/x-www-form-urlencoded',
  }
  const post = (at: string, fields: Record<string, string>) =>
    k.at(k.host, at, {
      method: 'POST',
      redirect: 'manual',
      headers,
      body: new URLSearchParams(fields),
    })
  const page = async (at: string, wanted: string) => {
    const r = await k.at(k.host, at, {
      redirect: 'manual',
      headers: { cookie: k.owner.cookie },
    })
    const text = await r.text()
    insist(
      r.status == 200 && text.includes(wanted),
      `${at}: ${r.status}, missing ${wanted}`,
    )
    return text
  }
  const follow = async (r: Response, wanted: string) => {
    insist(
      r.status == 303,
      `expected saved redirect, got ${r.status}: ${await r.clone().text()}`,
    )
    const u = new URL(r.headers.get('location')!, `https://${k.host}`)
    insist(u.origin == `https://${k.host}`, 'refusing an external redirect')
    await r.body?.cancel()
    return page(u.pathname + u.search, wanted)
  }
  const read = (q: string) => dir.query(q)
  const connection = async () => {
    const found = await read(
      `.connection.owner=${eid} .connection.integration=Benchmark-key *`,
    )
    insist(found.length == 1, 'one fixture connection must exist')
    return found[0] as unknown as {
      entity: { eid: string }
      connection: { status: string }
      secret?: { value?: string }
    }
  }
  const savedKey = async (r: Response) => {
    const text = await r.text()
    insist(
      r.status == 200 && text.includes('Saved. The key is kept safe'),
      `key not saved: ${r.status}: ${text.slice(-1000)}`,
    )
    const row = await connection()
    insist(
      row.connection.status == 'connected' &&
        row.secret?.value?.startsWith('yak_secret_'),
      'sealed connection readback',
    )
    return text
  }

  // A persistent owner grant populates management/connect and management/new.
  // A separate Claude grant is reset outside the timed disconnect operation.
  const authorize = async (brand: 'chatgpt' | 'claude') => {
    const back = brand == 'chatgpt'
      ? 'https://chatgpt.com/callback'
      : 'https://claude.ai/callback'
    const reg = await k.at(k.host, '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Local form benchmark',
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    insist(reg.status == 201, 'OAuth fixture registration')
    const { client_id } = await reg.json()
    const verifier = crypto.randomUUID() + crypto.randomUUID()
    const digest = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    )
    const challenge = btoa(String.fromCharCode(...digest)).replaceAll('+', '-')
      .replaceAll('/', '_').replaceAll('=', '')
    const q = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: back,
      scope: 'graph',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString()
    const allow = await allowed(k, q, k.owner.cookie)
    insist(allow.status == 302, 'OAuth fixture consent')
    const code = new URL(allow.headers.get('location')!).searchParams.get(
      'code',
    )!
    await allow.body?.cancel()
    const token = await post('/oauth/token', {
      grant_type: 'authorization_code',
      client_id,
      redirect_uri: back,
      code,
      code_verifier: verifier,
    })
    insist(token.status == 200, `OAuth fixture token ${token.status}`)
    await token.body?.cancel()
  }
  await authorize('chatgpt')
  const grants = async (): Promise<{ id: string }[]> => {
    const r = await k.at(k.host, '/oauth/agents', {
      headers: { cookie: k.owner.cookie },
    })
    insist(r.status == 200, 'agent listing')
    return (await r.json()).agents
  }
  insist(
    (await grants()).some((g) => g.id == 'chatgpt'),
    'persistent ChatGPT grant',
  )

  let revision = 0
  let from = moving[0]
  let upload = ''
  let pending = ''
  const email = 'forms-invite@benchmark.invalid'
  await agent.tool('member_add', { space, email, role: 'viewer' })
  await k.deliveries()
  // The page is the public source of the invitation eid, independent of how
  // invitation component names are qualified in the directory vocabulary.
  const people = await page(path('people'), email)
  pending = /name="again" value="([^"]+)"/.exec(people)?.[1] ?? ''
  insist(pending, 'pending invitation button')

  const out: Record<string, Operation> = {
    'form/settings-name': {
      act: async () => {
        const name = `Form benchmark ${++revision}`
        await follow(await post(path('settings'), { name }), name)
        const [row] = await read(`.entity.eid=${k.owner.person} ?doc`)
        insist(
          (row.doc as { title: string }).title == name,
          'saved name readback',
        )
      },
    },
    'form/settings-space': {
      act: async () => {
        const to = from == moving[0] ? moving[1] : moving[0]
        await follow(await post(path('settings', from), { space: to }), to)
        const found = await read(`.space.slug=${to}`)
        insist(found.length == 1, 'renamed space readback')
        from = to
      },
    },
    'form/restore': {
      prepare: async () => {
        await agent.tool('app_delete', { space, app: 'restored' })
        await k.settled()
        await page(path('trash'), 'name="restore" value="restored"')
      },
      act: async () => {
        await follow(
          await post(path('trash'), { restore: 'restored' }),
          '</html>',
        )
        await page(path(''), '/restored/')
        const trash = await page(path('trash'), '</html>')
        insist(
          !trash.includes('name="restore" value="restored"'),
          'restored app left trash',
        )
      },
    },
    'form/people-resend': {
      act: async () => {
        const before = letters(k, email).length
        await follow(
          await post(path('people'), { again: pending }),
          'Sent again.',
        )
        await k.deliveries()
        insist(
          letters(k, email).length == before + 1,
          'resend must deliver another local letter',
        )
      },
    },
    'form/connections-add': {
      prepare: async () => {
        const found = await read(
          `.connection.owner=${eid} .connection.integration=Benchmark-key *`,
        )
        if (found.length) {
          await dir.apply(
            found.map((b) => ({ entity: b.entity, $delete: true })),
          )
        }
      },
      act: async () =>
        savedKey(
          await post(path('connections'), {
            do: 'add',
            integration: 'Benchmark-key',
            hosts: 'api.benchmark.invalid',
            key: 'local-dummy-key',
          }),
        ),
    },
    'form/connections-key': {
      prepare: async () => {
        const found = await read(
          `.connection.owner=${eid} .connection.integration=Benchmark-key *`,
        )
        if (!found.length) {
          await savedKey(
            await post(path('connections'), {
              do: 'add',
              integration: 'Benchmark-key',
              hosts: 'api.benchmark.invalid',
              key: 'local-dummy-reset',
            }),
          )
        }
      },
      act: async () =>
        savedKey(
          await post(path('connections'), {
            do: 'key',
            connection: (await connection()).entity.eid,
            key: `local-dummy-key-${++revision}`,
          }),
        ),
    },
    'form/connections-disconnect': {
      prepare: async () => {
        const found = await read(
          `.connection.owner=${eid} .connection.integration=Benchmark-key *`,
        )
        if (!found.length) {
          await savedKey(
            await post(path('connections'), {
              do: 'add',
              integration: 'Benchmark-key',
              hosts: 'api.benchmark.invalid',
              key: 'local-dummy-reset',
            }),
          )
        } else {await savedKey(
            await post(path('connections'), {
              do: 'key',
              connection: (await connection()).entity.eid,
              key: 'local-dummy-reset',
            }),
          )}
      },
      act: async () => {
        const r = await post(path('connections'), {
          do: 'disconnect',
          connection: (await connection()).entity.eid,
        })
        const text = await r.text()
        insist(
          r.status == 200 && text.includes('Disconnected.'),
          'disconnect response',
        )
        insist(
          !(await read(
            `.connection.owner=${eid} .connection.integration=Benchmark-key`,
          )).length,
          'disconnected readback',
        )
      },
    },
    'form/connections-attach': {
      prepare: async () => {
        await detach()
        await ensureConnection()
      },
      act: async () => {
        const r = await post(path('connections'), {
          do: 'attach',
          connection: (await connection()).entity.eid,
          app: appEid,
        })
        insist(
          r.status == 200 &&
            (await r.text()).includes('can now use Benchmark-key'),
          'attached response',
        )
        insist((await links()).length == 1, 'attached link readback')
      },
    },
    'form/connections-open': {
      prepare: async () => {
        await attach(false)
      },
      act: async () => {
        await toggle(true)
      },
    },
    'form/connections-close': {
      prepare: async () => {
        await attach(true)
      },
      act: async () => {
        await toggle(false)
      },
    },
    'form/selling-start': {
      prepare: async () => {
        await follow(
          await post(path('selling', seller), { sell: 'stop' }),
          '</html>',
        )
      },
      act: async () => {
        const r = await post(path('selling', seller), { sell: 'start' })
        insist(
          r.status == 303 &&
            r.headers.get('location') ==
              'https://connect.stripe.com/setup/local-platform-waits',
          'local onboarding URL',
        )
        await r.body?.cancel()
        insist(
          !!(await read(`.space.slug=${seller} ?stripe`))[0].stripe,
          'onboarding stored account',
        )
      },
    },
    'form/connections-signin': {
      prepare: async () => {
        const r = await post(path('connections'), {
          do: 'add',
          integration: 'openrouter',
        })
        insist(
          r.status == 303,
          'OAuth connection fixture: ' + await r.clone().text(),
        )
        await r.body?.cancel()
      },
      act: async () => {
        const [row] = await read(
          `.connection.owner=${eid} .connection.integration=openrouter`,
        )
        insist(row, 'OAuth connection must exist')
        const r = await post(path('connections'), {
          do: 'signin',
          connection: String(row.entity.eid),
        })
        const u = new URL(
          r.headers.get('location') ?? 'https://missing.invalid',
        )
        insist(
          r.status == 303 && u.hostname == 'openrouter.ai' &&
            u.searchParams.has('code_challenge') &&
            !!r.headers.get('set-cookie'),
          'OAuth begin redirect and sealed attempt',
        )
        await r.body?.cancel()
      },
    },
    'form/app-new-upload': {
      prepare: async () => {
        if (upload) {
          await agent.tool('app_delete', { space, app: upload, forever: true })
        }
        upload = `uploaded-${++revision}`
      },
      act: () => drop(upload),
    },
    'form/app-update-upload': {
      prepare: async () => {
        await drop('updated')
      },
      act: () => drop('updated'),
    },
    'form/selling-stop': {
      prepare: async () => {
        const r = await post(path('selling', seller), { sell: 'start' })
        insist(
          r.status == 303 &&
            r.headers.get('location') ==
              'https://connect.stripe.com/setup/local-platform-waits',
          'local seller onboarding fixture',
        )
        await r.body?.cancel()
        const [row] = await read(`.space.slug=${seller} ?stripe`)
        insist(!!row.stripe, 'real connected seller fixture')
      },
      act: async () => {
        await follow(
          await post(path('selling', seller), { sell: 'stop' }),
          '</html>',
        )
        const [row] = await read(`.space.slug=${seller} ?stripe`)
        insist(!row.stripe, 'seller stop removes stripe component')
      },
    },
    'form/billing-checkout': {
      act: async () => {
        const r = await post(path('billing'), { billing: 'checkout' })
        insist(
          r.status == 200,
          `checkout ${r.status}: ${await r.clone().text()}`,
        )
        insist((await r.json()).url == CHECKOUT, 'local checkout URL')
        const [row] = await read(`.entity.eid=${eid} ?plan`)
        insist(
          (row.plan as { customer?: string })?.customer == CUSTOMER,
          'checkout saved customer',
        )
      },
    },
    'form/billing-portal': {
      prepare: async () => {
        const r = await post(path('billing'), { billing: 'checkout' })
        insist(
          r.status == 200 && (await r.json()).url == CHECKOUT,
          'portal customer fixture',
        )
      },
      act: async () => {
        const r = await post(path('billing'), { billing: 'portal' })
        insist(r.status == 200, `portal ${r.status}: ${await r.clone().text()}`)
        insist((await r.json()).url == PORTAL, 'local portal URL')
      },
    },
    'form/agent-disconnect': {
      prepare: async () => {
        await authorize('claude')
      },
      act: async () => {
        const r = await post('/oauth/agents/disconnect', {
          agent: 'claude',
          return: path('connect'),
        })
        await follow(r, '</html>')
        const now = await grants()
        insist(
          !now.some((g) => g.id == 'claude') &&
            now.some((g) => g.id == 'chatgpt'),
          'only selected agent disconnected',
        )
      },
    },
  }
  const drop = async (slug: string) => {
    const marker = `Form upload ${++revision}`
    const body = new FormData()
    body.set('slug', slug)
    body.set(
      'file',
      new File([`<!doctype html><h1>${marker}</h1>`], 'index.html', {
        type: 'text/html',
      }),
    )
    const r = await k.at(`${space}.${k.host}`, '/deploy', {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie: k.owner.cookie, origin: `https://${space}.${k.host}` },
      body,
    })
    const text = await r.text()
    insist(r.status == 200 && text.includes(slug), `drop ${r.status}: ${text}`)
    const served = await k.at(`${space}.${k.host}`, `/${slug}/`, {
      headers: { cookie: k.owner.cookie },
    })
    insist(
      served.status == 200 && (await served.text()).includes(marker),
      'deployed upload readback',
    )
  }
  await savedKey(
    await post(path('connections'), {
      do: 'add',
      integration: 'Benchmark-key',
      hosts: 'api.benchmark.invalid',
      key: 'local-dummy-key',
    }),
  )
  const [appRow] = await read(`.app.space=${eid} .app.slug=connected`)
  const appEid = String(appRow.entity.eid)
  const links = () => read(`.edge.from=${appEid} .uses *`)
  const detach = async () => {
    const found = await links()
    if (found.length) {
      await dir.apply(found.map((b) => ({ entity: b.entity, $delete: true })))
    }
  }
  const ensureConnection = async () => {
    const found = await read(
      `.connection.owner=${eid} .connection.integration=Benchmark-key`,
    )
    if (!found.length) {
      await savedKey(
        await post(path('connections'), {
          do: 'add',
          integration: 'Benchmark-key',
          hosts: 'api.benchmark.invalid',
          key: 'local-dummy-key',
        }),
      )
    }
  }
  const toggle = async (open: boolean) => {
    const r = await post(path('connections'), {
      do: open ? 'open' : 'close',
      connection: (await connection()).entity.eid,
      app: appEid,
    })
    insist(
      r.status == 200 &&
        (await r.text()).includes(
          open ? 'Anyone using the app may' : 'Only its members may',
        ),
      'connection sharing response',
    )
    insist(
      ((await links())[0]?.uses as { anyone?: boolean })?.anyone === open,
      'connection sharing readback',
    )
  }
  const attach = async (open: boolean) => {
    await ensureConnection()
    if (!(await links()).length) {
      const r = await post(path('connections'), {
        do: 'attach',
        connection: (await connection()).entity.eid,
        app: appEid,
      })
      insist(
        r.status == 200 && (await r.text()).includes('can now use'),
        'sharing link fixture',
      )
    }
    await toggle(open)
  }
  return out
}
