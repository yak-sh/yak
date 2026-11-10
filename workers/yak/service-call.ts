// The service door admits one operation, carrying no merchant membership.
import { type Bundle, type Comp } from '@yaks/graph'
import {
  grantService,
  known,
  need,
  type Read,
  type ServiceAuthority,
  serviceAuthority,
  serviceName,
  using,
} from '@yaks/connections'
import { mayCall, schemaOf } from '@yaks/tools/declared'
import { commandAt, toolsOf } from './app-command.ts'
import { acting } from './apps.ts'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { asCaller, type Ctx, refuse } from './tool.ts'
import { vouched, type Who } from './session.ts'
import type { Command } from './declared.ts'
import { opened, seal } from './lib/token.ts'

let read = (env: Env): Read => (q) =>
  meta(env).query(String(q)) as Promise<Bundle[]>

/** Recheck after a queue delay as well as at the initial dispatch. */
export let verifyService = async (
  env: Env,
  dir: Directory,
  a: ServiceAuthority,
) => {
  if (!await serviceAuthority(read(env), a)) return false
  let source = await dir.appAt(a.app)
  if (
    !source || source.app.trashed || source.space.trashed ||
    source.space.eid != a.space
  ) return false
  let target = await dir.appAt(a.service)
  if (!target || target.app.trashed || target.space.trashed) return false
  let tool = (await toolsOf(env, target.space, target.app))[a.operation]
  return !!tool?.service && !!tool.worker && mayCall(tool.floor, a.person, null)
}

export let serviceToken = (env: Env, a: ServiceAuthority) =>
  seal('service', a, env.SESSION_SECRET!)
export let serviceFrom = (env: Env, token: string) =>
  opened<ServiceAuthority>('service', token, env.SESSION_SECRET!)

/** Connect only this person's selected operations to the source app. */
export let connectService = async (
  env: Env,
  dir: Directory,
  source: { space: Space; app: App },
  who: Who,
  service: string,
  operations: string[],
) => {
  if (!who.person) {
    throw refuse('access', 'Sign in to connect a service')
  }
  let target = await dir.appAt(service)
  if (!target || target.app.trashed || target.space.trashed) {
    throw refuse('missing', 'The service is unavailable')
  }
  let tools = await toolsOf(env, target.space, target.app)
  if (
    !operations.every((name) =>
      typeof name == 'string' && tools[name]?.service && tools[name].worker &&
      mayCall(tools[name].floor, who.person, null)
    )
  ) {
    throw refuse(
      'arguments',
      'Select only the service operations offered to a person',
    )
  }
  let integration = serviceName(service)
  let i = await known(read(env), integration)
  if (i?.service?.app != service) {
    throw refuse('missing', 'The app has not published a service')
  }
  let g = meta(env)
  await g.apply(
    await need(read(env), {
      app: source.app.eid,
      owner: who.person,
      integration,
      each: true,
      scopes: [],
    }),
    vouched(who),
  )
  let connection = await using(read(env), {
    app: source.app.eid,
    owner: who.person,
    integration,
    each: true,
  })
  if (!connection) throw new Error('Service connection was not retained')
  await g.apply(
    await grantService(read(env), {
      person: who.person,
      connection: connection.entity.eid,
      operations,
    }),
    vouched(who),
  )
  return {
    connection: connection.entity.eid,
    at: serviceAt(service, source.app.eid),
  }
}

/** One app API or connector call, as the current customer. */
export let callService = async (
  env: Env,
  dir: Directory,
  source: { space: Space; app: App },
  who: Who,
  service: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; value: Record<string, unknown> }> => {
  if (!who.person) throw refuse('access', 'Sign in to call an app service')
  let i = await known(read(env), serviceName(service))
  if (i?.service?.app != service) {
    throw refuse('missing', 'No app service has that identity')
  }
  let connections = await read(env)(
    `.connection.owner=${who.person}&.connection.integration=${
      serviceName(service)
    }`,
  )
  let authority: ServiceAuthority | undefined
  for (let b of connections) {
    let a = {
      person: who.person,
      app: source.app.eid,
      space: source.space.eid,
      service,
      connection: b.entity.eid,
      operation: name,
    }
    if (await verifyService(env, dir, a)) {
      authority = a
      break
    }
  }
  if (!authority) {
    throw refuse(
      'access',
      'Connect this service and grant this operation first',
    )
  }
  let target = await dir.appAt(service)
  if (!target || target.app.trashed || target.space.trashed) {
    throw refuse('missing', 'This service is unavailable')
  }
  let tool = (await toolsOf(env, target.space, target.app))[name]
  let customer: Who = {
    person: who.person,
    actor: who.actor,
    agent: who.agent,
    via: who.via,
    role: null,
    service: authority,
  }
  if (
    !tool?.service || !tool.worker ||
    !mayCall(tool.floor, customer.person, null)
  ) throw refuse('access', 'This operation is not offered to service customers')
  let answer = await commandAt(
    env,
    target.space,
    target.app,
    customer,
    name,
    tool,
    args,
    acting(env, target.space, target.app, customer),
    {
      source: JSON.stringify({
        ...authority,
        authority: await serviceToken(env, authority),
      }),
    },
  )
  return { ...answer, value: { ...answer.value, service: authority } }
}

/** Stable connector address, including the app that holds the connection. */
export let serviceAt = (service: string, app: string) =>
  `service:${service}/${app}`

export let runServiceCommand = async (
  ctx: Ctx,
  said: string,
  name: string,
  args: Record<string, unknown>,
) => {
  let [service, app] = said.slice('service:'.length).split('/')
  let source = await ctx.dir.appAt(app)
  if (!source) throw refuse('missing', 'The source app is unavailable')
  if (
    (ctx.who?.spaceEid && ctx.who.spaceEid != source.space.eid) ||
    (!ctx.who?.spaceEid && ctx.who?.space && ctx.who.space != source.space.slug)
  ) {
    throw refuse('access', 'This credential does not reach the source space')
  }
  let role = await ctx.dir.role(source.space, ctx.person)
  let who = asCaller(ctx, role)
  return callService(ctx.env, ctx.dir, source, who, service, name, args)
}

export let listServiceCommands = async (
  ctx: Ctx,
  said = '',
): Promise<Command[]> => {
  let out: Command[] = []
  let connections = await read(ctx.env)(
    `.connection.owner=${ctx.person}&.connection.status=connected`,
  )
  for (let connection of connections) {
    let c = connection.connection as Comp | undefined
    if (!c || typeof c.integration != 'string' || !Array.isArray(c.scopes)) {
      continue
    }
    let offer = await known(read(ctx.env), c.integration)
    if (!offer?.service) continue
    let target = await ctx.dir.appAt(offer.service.app)
    if (!target || target.app.trashed || target.space.trashed) continue
    let tools = await toolsOf(ctx.env, target.space, target.app)
    let links = await read(ctx.env)(
      `.edge.to=${connection.entity.eid}&.uses&?edge`,
    )
    for (let link of links) {
      let app = (link.edge as Comp | undefined)?.from
      if (typeof app != 'string') continue
      let source = await ctx.dir.appAt(app)
      if (
        !source ||
        (ctx.who?.spaceEid && ctx.who.spaceEid != source.space.eid) ||
        (!ctx.who?.spaceEid && ctx.who?.space &&
          ctx.who.space != source.space.slug)
      ) continue
      let at = serviceAt(target.app.eid, app)
      if (said && said != at) continue
      for (let name of c.scopes) {
        if (typeof name != 'string') continue
        let tool = tools[name]
        if (
          !tool?.service || !tool.worker || tool.discoverable === false ||
          !mayCall(tool.floor, ctx.person, null)
        ) continue
        if (
          !await verifyService(ctx.env, ctx.dir, {
            person: ctx.person,
            app,
            space: source.space.eid,
            service: target.app.eid,
            connection: connection.entity.eid,
            operation: name,
          })
        ) continue
        out.push({
          at,
          name,
          title: `${offer.title || offer.name}: ${name}`,
          description: tool.description,
          input: schemaOf(tool),
          readOnly: tool.readOnly === true,
        })
      }
    }
  }
  return out
}
