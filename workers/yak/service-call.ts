// The service door admits one operation, carrying no merchant membership.
import { line } from '@yaks/query'
import type { Comp } from '@yaks/graph'
import {
  grantService,
  known,
  need,
  serviceAt,
  type ServiceAuthority,
  serviceName,
  using,
} from '@yaks/connections'
import { mayCall, schemaOf } from '@yaks/tools/declared'
import { commandAt } from './app-command.ts'
import { toolsOf } from './declaration.ts'
import { acting } from './apps.ts'
import type { App, Directory } from './directory.ts'
import type { Env } from './env.ts'
import { meta } from './meta.ts'
import { asCaller, type Ctx, refuse } from './tool.ts'
import { vouched, type Who } from './session.ts'
import type { Command } from './declared.ts'
import { opened, seal } from './lib/token.ts'
import { mode, reads } from '@yaks/member'
import { atApp } from '@yaks/platform/visits'
import {
  serviceRead as read,
  serviceRole,
  type Source,
  verifyService,
} from './service-authority.ts'

export { serviceRole, verifyService } from './service-authority.ts'

export let serviceUser = (app: App, who: Who) => {
  let caller = atApp(who)
  if (
    !caller.person || caller.person == app.eid ||
    !reads(mode(app.access), caller.role)
  ) throw refuse('access', 'Use the source app as a signed-in person')
  return { ...caller, person: caller.person }
}

export let serviceToken = (env: Env, a: ServiceAuthority) =>
  seal('service', a, env.SESSION_SECRET!)
export let serviceFrom = (env: Env, token: string) =>
  opened<ServiceAuthority>('service', token, env.SESSION_SECRET!)

/** Resolve the service and validate the operations offered to this person. */
export let offeredService = async (
  env: Env,
  dir: Directory,
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
  return { target, tools, integration }
}

/** Record the source app's request without granting any operations. */
export let requestService = async (
  env: Env,
  dir: Directory,
  source: Source,
  who: Who,
  service: string,
  operations: string[],
) => {
  let caller = serviceUser(source.app, who)
  let { integration } = await offeredService(
    env,
    dir,
    caller,
    service,
    operations,
  )
  let g = meta(env)
  await g.apply(
    await need(read(env), {
      app: source.app.eid,
      owner: caller.person,
      integration,
      each: true,
      scopes: [],
    }),
    vouched(caller),
  )
  let connection = await using(read(env), {
    app: source.app.eid,
    owner: caller.person,
    integration,
    each: true,
  })
  if (!connection) throw new Error('Service connection was not retained')
  return {
    connection: connection.entity.eid,
    at: serviceAt(service, source.app.eid),
  }
}

/** Connect only this person's selected operations to the source app. */
export let connectService = async (
  env: Env,
  dir: Directory,
  source: Source,
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
  await meta(env).apply(
    await grantService(read(env), {
      person: who.person!,
      connection: connection.connection,
      operations,
    }),
    vouched(who),
  )
  return connection
}

/** One app API or connector call, as the current customer. */
export let callService = async (
  env: Env,
  dir: Directory,
  source: Source,
  who: Who,
  service: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; value: Record<string, unknown> }> => {
  let caller = serviceUser(source.app, who)
  let i = await known(read(env), serviceName(service))
  if (i?.service?.app != service) {
    throw refuse('missing', 'No app service has that identity')
  }
  let connections = await read(env)(
    line`.connection.owner=${caller.person}&.connection.integration=${
      serviceName(service)
    }`,
  )
  let authority: ServiceAuthority | undefined
  for (let b of connections) {
    let a = {
      person: caller.person,
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
    person: caller.person,
    actor: caller.actor,
    agent: caller.agent,
    via: caller.via,
    role: null,
    service: authority,
  }
  if (
    !tool?.service || !tool.worker ||
    !mayCall(tool.floor, customer.person, null)
  ) {
    throw refuse(
      'access',
      'This operation is not offered to service customers',
    )
  }
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
  let role = await serviceRole(ctx.dir, source, ctx.person)
  let who = asCaller(ctx, role)
  return callService(ctx.env, ctx.dir, source, who, service, name, args)
}

export let listServiceCommands = async (
  ctx: Ctx,
  said = '',
): Promise<Command[]> => {
  let out: Command[] = []
  let connections = await read(ctx.env)(
    line`.connection.owner=${ctx.person}&.connection.status=connected`,
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
      line`.edge.to=${connection.entity.eid}&.uses&?edge`,
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
