// A page requests service access; only the platform's consent form grants it.
import { h } from 'preact'
import { CallError, refused } from '@yaks/tools/errors'
import { spaceHost, url } from '@yaks/platform/host'
import { signInAt } from '@yaks/platform/routes'
import { type App, type Directory, directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { opened, seal } from './lib/token.ts'
import { held, page, send } from './pages.ts'
import { type Who, whoIs } from './session.ts'
import {
  connectService,
  offeredService,
  requestService,
} from './service-call.ts'

type Ask = {
  person: string
  app: string
  service: string
  operations: string[]
  exp: number
}
type Consent = { person: string; request: string; exp: number }
let DOOR = '/connect/service'
let HOUR = 60 * 60

/** Retain the ask and return the platform page where it can be approved. */
export let askService = async (
  env: Env,
  dir: Directory,
  source: { space: Space; app: App },
  who: Who,
  service: string,
  operations: string[],
) => {
  let connection = await requestService(
    env,
    dir,
    source,
    who,
    service,
    operations,
  )
  let request = await seal(
    'service-request',
    {
      person: who.person!,
      app: source.app.eid,
      service,
      operations,
      exp: Math.floor(Date.now() / 1000) + HOUR,
    } satisfies Ask,
    env.SESSION_SECRET!,
  )
  return {
    ...connection,
    url: url(env, `${DOOR}?request=${encodeURIComponent(request)}`),
  }
}

let backTo = (env: Env, source: { space: Space; app: App }) =>
  `https://${spaceHost(env, source.space.slug)}/${source.app.slug}/`

/** Browser sessions alone reach this door; request and consent have separate seals. */
export let serviceConsent = async (req: Request, env: Env) => {
  if (req.method != 'GET' && req.method != 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
  }
  let who = await whoIs(req, env.SESSION_SECRET, () => Promise.resolve(null))
  if (!who.person) return Response.redirect(signInAt(req.url, env), 303)
  try {
    let form = req.method == 'POST' ? await req.formData() : null
    let request = String(
      form?.get('request') ?? new URL(req.url).searchParams.get('request') ??
        '',
    )
    let ask = await opened<Ask>(
      'service-request',
      request,
      env.SESSION_SECRET!,
    )
    if (!ask || ask.person != who.person || ask.exp * 1000 <= Date.now()) {
      throw new CallError(
        'access',
        'This service request expired. Connect again from the app.',
      )
    }
    let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
    let source = await dir.appAt(ask.app)
    if (!source || source.app.trashed || source.space.trashed) {
      throw new CallError('missing', 'The app is unavailable')
    }
    let { target, tools } = await offeredService(
      env,
      dir,
      who,
      ask.service,
      ask.operations,
    )
    if (form) {
      let consent = await opened<Consent>(
        'service-consent',
        String(form.get('consent') ?? ''),
        env.SESSION_SECRET!,
      )
      if (
        !consent || consent.person != who.person ||
        consent.request != request || consent.exp * 1000 <= Date.now()
      ) {
        throw new CallError(
          'access',
          'Open the service consent page and choose Allow.',
        )
      }
      await connectService(env, dir, source, who, ask.service, ask.operations)
      return Response.redirect(backTo(env, source), 303)
    }
    let consent = await seal(
      'service-consent',
      {
        person: who.person,
        request,
        exp: ask.exp,
      } satisfies Consent,
      env.SESSION_SECRET!,
    )
    return page(
      env,
      {
        title: `Connect ${target.app.title}`,
        lead: `${source.app.title} wants to use these operations as you.`,
        headers: {
          'cache-control': 'private, no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "frame-ancestors 'none'",
        },
      },
      h('p', null, 'App: ', backTo(env, source)),
      h('p', null, 'Service: ', backTo(env, target)),
      h(
        'ul',
        null,
        ask.operations.map((name) =>
          h(
            'li',
            { key: name },
            h('strong', null, name),
            ': ',
            tools[name].description,
            h('p', null, tools[name].service!.pricing),
          )
        ),
      ),
      h(
        'form',
        { class: 'Page_Form', method: 'post', action: DOOR },
        held('request', request),
        held('consent', consent),
        send('Allow'),
      ),
      h('a', { href: backTo(env, source) }, 'Cancel'),
    )
  } catch (error) {
    if (error instanceof CallError) return refused(error)
    throw error
  }
}
