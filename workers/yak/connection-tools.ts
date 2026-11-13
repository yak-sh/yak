// The connection tools (T-38030), their rows apart from connections.ts so a
// page that only serves a space never compiles the roster's words (T-148886).
import {
  ABOUT,
  attach,
  CONNECTION,
  integrationEid,
  known,
  PUBLISHED,
  publishService,
  set,
  USES,
  using,
} from '@yaks/connections'
import { edgeEid } from '@yaks/edge'
import { url } from '@yaks/platform/host'
import { APP, inApp, inSpace, refuse, SPACE, str, text } from './tool.ts'
import { type Row, worded } from './tool-words.ts'
import { serviceOffer } from './app-services.ts'
import { declarationOf } from './declaration.ts'
import { INTEGRATIONS, said } from './integrations.ts'
import { EITHER } from './preauth.ts'
import {
  barred,
  comp,
  ctxOf,
  EID,
  holdOf,
  lending,
  rebound,
} from './connections.ts'

// ---- the tools (T-38030) ---------------------------------------------------

// Attaching a connected credential remains a platform verb. The package owns
// need and list; published.ts translates their former connector arguments.
let CONNECTIONS: Row[] = [
  {
    name: 'connection_attach',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        connection: str(
          'the id of a connected connection owned by this space, from ' +
            'store_connection_list',
        ),
        binding: str(
          'the name the app reads it as, env.NAME in worker.js and from ' +
            "./api/env in a page; omit for the service's name in capitals",
        ),
      },
      required: ['app', 'connection'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      if (who.role != 'owner') {
        throw refuse(
          'access',
          `only the owner of ${space.slug} may attach its connection`,
        )
      }
      let connection = text(args.connection, 'connection')
      let c = ctxOf(ctx.env, who)
      let [b] = EID.test(connection)
        ? await c.graph.read(`.entity.eid=${connection}&.${CONNECTION}`)
        : []
      let refused = barred(
        'attach',
        await holdOf(ctx.env, space, who, b, app.eid),
      )
      if (refused) throw refuse('access', refused)
      let bundles = await attach(c.graph.read, {
        owner: space.eid,
        app: app.eid,
        connection,
        ...args.binding == null
          ? {}
          : { binding: text(args.binding, 'binding') },
      }).catch((e) => {
        throw refuse('conflict', e instanceof Error ? e.message : String(e))
      })
      if (bundles.length) await c.graph.apply(bundles)
      await rebound(ctx.env, [app.eid])
      let [l] = await c.graph.read(
        `.entity.eid=${edgeEid(app.eid, USES, connection)}&.${USES}`,
      )
      return {
        space,
        text: `${space.slug}/${app.slug} can use connection ${connection}, ` +
          `as env.${comp(l, USES).binding}. ` +
          'Only app members can call out through it. The credential stays in the vault.',
      }
    },
  },
  {
    name: 'connection_lend',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        integration: str(
          'the integration of a shared connection this app uses',
        ),
        cap: {
          type: ['integer', 'null'],
          minimum: 1,
          description:
            'the calls a month each installed copy may make; null stops lending and recalls outstanding loans from this app',
        },
      },
      required: ['app', 'integration', 'cap'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      if (who.role != 'owner') {
        throw refuse(
          'access',
          `only the owner of ${space.slug} may lend its connection`,
        )
      }
      let integration = text(args.integration, 'integration')
      let c = ctxOf(ctx.env)
      // An app with none to lend is told so by `lend`.
      let connection = await using(c.graph.read, { app: app.eid, integration })
      let refused = connection &&
        barred('lend', await holdOf(ctx.env, space, who, connection, app.eid))
      if (refused) throw refuse('access', refused)
      if (args.cap !== null && typeof args.cap != 'number') {
        throw refuse(
          'cap',
          'Give a whole number of calls a month, or null to stop lending.',
        )
      }
      let cap = args.cap as number | null
      await lending(ctx.env, app.eid, integration, cap)
      return {
        space,
        text: cap == null
          ? `${space.slug}/${app.slug} stopped lending ${integration}; every copy borrowing through it needs its own connection now.`
          : `${space.slug}/${app.slug} lends ${integration} to copies installed from it, capped at ${cap} calls a month each. A changed cap reaches copies already borrowing it. The key stays in the vault; each copy keeps its own data and may connect its own key instead.`,
      }
    },
  },
  {
    name: 'service_connect',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        service: str('the stable service app id from integration_list'),
        operations: {
          type: 'array',
          items: { type: 'string' },
          description:
            'the selected service commands; an empty list revokes this connection',
        },
      },
      required: ['app', 'service', 'operations'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      if (!who.person) throw refuse('access', 'Sign in to connect a service')
      let service = text(args.service, 'service')
      if (!Array.isArray(args.operations)) {
        throw refuse('arguments', 'Give selected operations as a list')
      }
      let { connectService } = await import('./service-call.ts')
      let value = await connectService(
        ctx.env,
        ctx.dir,
        { space, app },
        who,
        service,
        args.operations as string[],
      )
      return {
        space,
        text: `${
          args.operations.length ? 'Connected' : 'Revoked'
        } service for this person in ${
          app.title || app.slug
        }. Purchases still require checkout or explicit purchase authority.`,
        value,
      }
    },
  },
  {
    name: 'integration_publish',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        title: str('the service name people see'),
        tagline: str('what the service does'),
        description: str('the service and its selling terms'),
        listed: {
          type: 'boolean',
          description:
            'publish, or withdraw discovery while preserving orders and connections',
        },
      },
      required: ['app', 'listed'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args)
      if (who.role != 'owner') {
        throw refuse('access', 'Only the app owner publishes a service')
      }
      let { tools } = await declarationOf(ctx.env, space, app)
      if (
        args.listed &&
        !Object.values(tools).some((t) => t.service && t.discoverable !== false)
      ) {
        throw refuse(
          'arguments',
          'Mark a declared command with service: {pricing: "its terms"} before publishing',
        )
      }
      let c = ctxOf(ctx.env, who)
      await c.graph.apply(
        await publishService(c.graph.read, {
          app: app.eid,
          owner: space.eid,
          title: args.title == null
            ? app.title || app.slug
            : String(args.title),
          ...args.tagline == null ? {} : { tagline: String(args.tagline) },
          ...args.description == null
            ? {}
            : { description: String(args.description) },
          listed: args.listed === true,
        }),
      )
      return {
        space,
        text: `${app.title || app.slug}: service ${
          args.listed ? 'listed' : 'withdrawn'
        }`,
      }
    },
  },
  {
    name: 'integration_set',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        integration: str(
          'a custom integration this space made, by name, as ' +
            'store_connection_list names it',
        ),
        title: str('what a person calls the service, as its maker writes it'),
        tagline: str('one line saying what the service is'),
        site: str("the service's https address on the web"),
        instructions: str(
          'how a person gets its key, in markdown, written for them and the ' +
            'agent helping them: where to sign up, which page issues the ' +
            'key, what to paste',
        ),
        listed: {
          type: 'boolean',
          description: 'true lists it in the integration directory at ' +
            'yaks.app/integrations, where anyone may find it and add it to ' +
            'a space of theirs with their own key; false takes it out',
        },
      },
      required: ['integration'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      if (who.role != 'owner') {
        throw refuse(
          'access',
          `only the owner of ${space.slug} changes what its integrations say`,
        )
      }
      let name = text(args.integration, 'integration')
      let c = ctxOf(ctx.env, who)
      let about = Object.fromEntries(
        ABOUT.filter((k) => args[k] != null).map((k) => [k, String(args[k])]),
      )
      let bundles = await set(c.graph.read, {
        ...about,
        owner: space.eid,
        integration: name,
        ...args.listed == null ? {} : { listed: args.listed == true },
      })
      if (bundles.length) await c.graph.apply(bundles)
      let i = await known(c.graph.read, name)
      let shown = (await c.graph.read(
        `.entity.eid=${integrationEid(name)}&.${PUBLISHED}`,
      )).length > 0
      let said = (['title', 'tagline', 'site'] as const)
        .filter((k) => i?.[k]).map((k) => `${k} ${i![k]}`).join('; ')
      return {
        space,
        text:
          `${name} says: ${said || 'no title, tagline or site'}.${
            i?.instructions
              ? `\n\nHow to get its key:\n\n${i.instructions}`
              : '\n\nIt says nothing yet of how to get its key.'
          }\n\nIts key is only ever sent to ${
            i?.hosts.join(', ') || 'no host'
          }, which no change here moves. Each space's connections page shows ` +
          'the instructions beside a connection needing its key. ' +
          (shown
            ? `It is listed in the integration directory, whose page shows ` +
              `it within half a minute: ${url(ctx.env, INTEGRATIONS.path)}#${
                encodeURIComponent(name)
              }`
            : 'It is not listed in the integration directory; listed: true ' +
              'lists it.'),
      }
    },
  },
  {
    name: 'integration_list',
    readOnly: true,
    // A token is welcome and none is needed: the directory is public, and
    // this is how the anonymous door knows it may call this (anon.ts
    // `openly`).
    security: EITHER,
    input: {
      type: 'object',
      properties: {
        words: str(
          'what to look for, in the words the person used: matched against ' +
            "each service's name, title, summary, description, integration details, docs, categories, site, hosts and instructions",
        ),
      },
    },
    run: async (ctx, args) => {
      let words = args.words == null ? '' : String(args.words)
      let offers = await ctx.dir.integrations()
      let services = await Promise.all(
        offers.filter((i) => i.service).map((i) =>
          serviceOffer(ctx.env, ctx.dir, i)
        ),
      )
      let terms = words.toLowerCase().split(/\s+/).filter(Boolean)
      let matches = (i: unknown) =>
        terms.every((word) => JSON.stringify(i).toLowerCase().includes(word))
      let all = [
        ...offers.filter((i) => !i.service),
        ...services.filter((i) => i != null),
      ].filter(matches)
      return {
        text: said(all, words, ctx.env) +
          services.filter((i) => i != null).filter(matches).map((i) =>
            `\n\n${i.name} operations: ${JSON.stringify(i.commands)}`
          ).join(''),
      }
    },
  },
]

/** The connector row for attaching a space's connected credential. */
export let connectionTools = CONNECTIONS.map(worded)
