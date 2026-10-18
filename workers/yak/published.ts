// The tool list a directory published, and the translations that keep it
// answering (M-37853).
//
// A directory snapshots `tools/list` when a connector is submitted and serves
// that snapshot to everyone who installs it from there; only `tools/call`
// reaches us. So every name in the listing answers, with the arguments it was
// listed with, until a new listing is released. A tool renamed or dropped
// since is kept here as a translation onto what does its work now. Only the
// connector door answers one (agent.ts `platform`), and no `tools/list` names
// it: a call reaching it came from a snapshot, and a client listing the tools
// today is offered the tool doing the work. The builder, which no directory
// lists, never sees them.
//
// The release that publishes a new listing replaces LISTING with the tools it
// lists and deletes every translation whose name it no longer carries.
import {
  connect,
  disconnect,
  INTEGRATION,
  need,
  type Read,
  used,
  USES,
} from '@yaks/connections'
import type { Bundle, Comp, NamedTool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { ctxOf, pageOf, rebind } from './connections.ts'
import { storeName } from './directory.ts'
import { CWD, TIMEOUT } from './sandbox.ts'
import { vaulted } from './vault.ts'
import {
  APP,
  type Ctx,
  inApp,
  inSpace,
  refuse,
  type Row,
  SPACE,
  str,
  text,
  type Tool,
  worded,
} from './tool.ts'
import { call } from './tools.ts'
import type { Supply } from '@yaks/builders'
import type { Ask } from '@yaks/builders/tools'
import { edgeEid } from '@yaks/edge'
import { CONNECTION } from '@yaks/connections'
import { heard, LAST } from '@yaks/memory'
import { invokePackage } from './package-tools.ts'
import { apex } from './host.ts'

/** The Claude connector directory's listing: what `tools/list` answered when
 * it was submitted on 2026-09-22, with main at aa4e26e6. */
export let LISTING = {
  directory: 'Claude connector directory',
  submitted: '2026-09-22',
  commit: 'aa4e26e6',
  tools: [
    'space_new',
    'space_set',
    'space_delete',
    'space_restore',
    'space_sell',
    'app_new',
    'app_files',
    'sandbox_exec',
    'sandbox_write',
    'sandbox_read',
    'sandbox_ship',
    'app_deploy',
    'store_load',
    'app_versions',
    'app_rollback',
    'store_restore',
    'app_set',
    'app_secret_set',
    'app_secret_list',
    'app_secret_remove',
    'app_delete',
    'app_restore',
    'app_errors',
    'app_list',
    'commands',
    'command',
    'domain_attach',
    'domain_status',
    'domain_detach',
    'app_publish',
    'app_unpublish',
    'app_published',
    'app_install',
    'app_update',
    'member_add',
    'member_remove',
    'grant',
    'feedback',
    'guide',
    'about',
    'gallery_search',
    'memory_save',
    'memory_recall',
    'app_stats',
    'graph_apply',
    'graph_query',
    'graph_show',
    'graph_schema',
    'search',
    'mail_list',
    'mail_send',
  ],
}

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

// A secret as the listing named it: the name worker.js reads it by.
let NAME = str(
  'the name worker.js reads as env.NAME, e.g. WEATHER_KEY; letters, digits ' +
    'and underscores, not starting with a digit',
)

// The shared links an app's worker reads a name through.
let linksOf = async (read: Read, app: string) =>
  (await read(`.edge.from=${app}&.${USES}&*`))
    .filter((l) => !comp(l, USES).each)

let ROWS: Row[] = [
  // sandbox_shell, under the name, arguments and seconds it was listed with,
  // answering what sandbox_shell answers: the exit code and the last lines
  // the command printed, which is what the listing promised.
  {
    name: 'sandbox_exec',
    destructive: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        cmd: str('the command, run in a shell, e.g. cargo build --release'),
        cwd: str(`the directory to run it in (default ${CWD})`),
        timeout: {
          type: 'number',
          description: `seconds to allow it (default and maximum, ${
            TIMEOUT / 1000
          })`,
        },
      },
      required: ['cmd'],
    },
    run: (ctx, args) => {
      let secs = Number(args.timeout ?? 0)
      return call(ctx, 'sandbox_shell', {
        space: args.space,
        command: text(args.cmd, 'cmd'),
        cwd: args.cwd ?? CWD,
        timeout: secs > 0 ? Math.min(secs * 1000, TIMEOUT) : TIMEOUT,
      })
    },
  },
  // A secret is a connection now: a key of the app's own, handed to its
  // worker as itself under the secret's name (connection_need `direct`).
  {
    name: 'app_secret_set',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        name: NAME,
        value: str('the secret itself; it is never returned by any tool'),
      },
      required: ['app', 'name', 'value'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let name = text(args.name, 'name')
      let value = text(args.value, 'value')
      if (!vaulted(ctx.env)) {
        throw refuse('unavailable', "Keys can't be saved here yet.")
      }
      let c = ctxOf(ctx.env, who)
      let asked = await need(c.graph.read, {
        owner: space.eid,
        app: app.eid,
        integration: name,
        binding: name,
        direct: true,
      }).catch((e) => {
        throw refuse('arguments', e instanceof Error ? e.message : String(e))
      })
      let made = await c.graph.apply(asked)
      let eid = made.find((b) => !b.edge && !b[INTEGRATION])!.entity.eid
      await connect(c, eid, { key: value })
      await rebind(ctx.env, app.script ?? storeName(space, app), app.eid)
      return {
        space,
        text: `${space.slug}/${app.slug}: ${name} is set — worker.js reads ` +
          `it as env.${name}, and nothing can read it back`,
      }
    },
  },
  {
    name: 'app_secret_list',
    readOnly: true,
    input: {
      type: 'object',
      properties: { space: SPACE, app: APP },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args)
      let names = (await used(ctxOf(ctx.env), app.eid))
        .filter((r) => !comp(r.link, USES).each)
        .map((r) => String(comp(r.link, USES).binding))
      return {
        space,
        text: names.length
          ? `${space.slug}/${app.slug}: ${names.join(', ')} — worker.js ` +
            'reads each as env.NAME; no value is ever answered'
          : `${space.slug}/${app.slug} has no secrets`,
      }
    },
  },
  // The name's link goes, and a key handed to no other app is forgotten with
  // it, as a removed secret was. A connection read through a sentinel may be
  // an account the person signed in to, so it stays for them to end.
  {
    name: 'app_secret_remove',
    destructive: true,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        name: str('the secret name to remove, e.g. WEATHER_KEY; not its value'),
      },
      required: ['app', 'name'],
    },
    run: async (ctx, args) => {
      let { space, app, who } = await inApp(ctx, args, true)
      let name = text(args.name, 'name')
      let c = ctxOf(ctx.env, who)
      let link = (await linksOf(c.graph.read, app.eid))
        .find((l) => comp(l, USES).binding == name)
      if (link) {
        let to = String(comp(link, 'edge').to)
        await c.graph.apply([{
          entity: { eid: link.entity.eid },
          tombstone: {},
        }])
        let left = await c.graph.read(`.edge.to=${to}&.${USES}`)
        if (comp(link, USES).direct && !left.length) await disconnect(c, to)
      }
      await rebind(
        ctx.env,
        app.script ?? storeName(space, app),
        app.eid,
        [name],
      )
      return { space, text: `${space.slug}/${app.slug}: ${name} removed` }
    },
  },
]

// Package builder tools answer their ids in content.body.
let answer = (bundles: Bundle[]) =>
  bundles.map((b) => comp(b, 'content').body)
    .filter((body): body is string => typeof body == 'string').join('\n')

let integrationOf = (b: Bundle | undefined) =>
  String(comp(b, CONNECTION).integration)

let said = (u: Comp, title: string) =>
  `${title} reads it as env.${u.binding}${
    u.direct ? ' (the key itself)' : ' (a sentinel)'
  }${u.anyone ? ', open to anyone using it' : ''}`

// TODO: delete these translations in the release that drops their published
// names and argument contracts from the connector directories' next listing.
let MEMORY: Row[] = [
  // What the person said, kept as they said it (memory.ts, T-34473). Owner,
  // 2026-09-06: "any user instruction about *how* they like their apps built
  // (etc) could be saved. And we could incorporate our 'grapevine' problem
  // learnings by prompting the agent to save what the user said verbatim
  // along with only the required context to understand it." An app's NOTES.md
  // is the rules for one app, written by an agent; these are the person's own
  // sentences, space-wide, and every agent who can reach the space is handed
  // the newest few at connect (standing.ts).
  {
    name: 'memory_save',
    destructive: false,
    input: {
      type: 'object',
      properties: {
        said: str(
          "the words to keep: a person's sentence as they said it, or a " +
            'note of your own',
        ),
        context: str(
          'a line or two saying what was being talked about, where the ' +
            'words do not stand on their own',
        ),
        about: str(
          'the app they were talking about, by slug, if there was one',
        ),
        space: SPACE,
      },
      required: ['said'],
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let made = await invokePackage(ctx, 'memory_save', {
        space: space.slug,
        said: text(args.said, 'said'),
        context: args.context == null ? '' : String(args.context),
        about: args.about == null ? '' : String(args.about),
      })
      let kept = heard(made.find((b) => b.memory)!)
      return {
        space,
        text: `Kept, in their words, for everyone in ${space.slug}:\n\n` +
          `"${kept.said}"${kept.context ? `\n${kept.context}` : ''}\n\n` +
          'Every agent that connects here is handed it; memory_recall ' +
          'finds it by what it is about.',
      }
    },
  },
  {
    name: 'memory_recall',
    readOnly: true,
    input: {
      type: 'object',
      properties: {
        words: str(
          'what the memory is about, in a few words: "how the pages look", ' +
            '"measurements in a recipe". Leave it out for the newest',
        ),
        limit: {
          type: 'number',
          description: 'how many at most (default 8)',
        },
        space: SPACE,
      },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let said = args.words == null ? '' : String(args.words)
      let limit = args.limit == null ? LAST : Number(args.limit)
      let recall = async (ask: Record<string, unknown>) =>
        (await invokePackage(ctx, 'memory_recall', {
          space: space.slug,
          limit,
          ...ask,
        })).map(heard)
      // Words nothing answers answer the newest, as this name always did.
      let held = said ? await recall({ said }) : []
      if (!held.length) held = await recall({})
      if (!held.length) {
        return {
          space,
          text: `Nothing has been kept in ${space.slug} yet. When they say ` +
            'how they want something built or handled, memory_save keeps ' +
            'their words.',
        }
      }
      return {
        space,
        text: held.map((m) =>
          `"${m.said}"${m.context ? `\n  ${m.context}` : ''}` +
          `${m.about ? `\n  about the ${m.about} app` : ''}` +
          `${
            m.by ? `\n  — ${m.by}${m.at ? `, ${m.at.slice(0, 10)}` : ''}` : ''
          }`
        ).join('\n\n'),
      }
    },
  },
]

let CONNECTIONS: Row[] = [
  {
    name: 'connection_need',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        app: APP,
        integration: str(
          'the outside service: a built integration by name, or a name of ' +
            'your own for any other key (then give hosts)',
        ),
        hosts: {
          type: 'array',
          items: { type: 'string' },
          description: 'for a key of your own naming: the API hosts it may ' +
            'be sent to, e.g. ["api.weatherapi.com"]',
        },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'what the app asks for, for a service signed in to; ' +
            "omit for the integration's own",
        },
        binding: str(
          "the name worker.js reads it as, env.NAME; omit for the service's " +
            'name in capitals',
        ),
        direct: {
          type: 'boolean',
          description: 'hand worker.js the key itself rather than a ' +
            'sentinel, only for a key it must sign with before sending',
        },
        each: {
          type: 'boolean',
          description: 'each person who uses the app connects their own ' +
            'account (their calendar, their inbox), rather than the owner ' +
            'connecting one for everyone; only they call out through it',
        },
      },
      required: ['app', 'integration'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args, true)
      let made = await invokePackage(ctx, 'connection_need', {
        ...args,
        space: space.slug,
        app: app.slug,
        owner: space.eid,
      })
      let read = ctxOf(ctx.env).graph.read
      // The connection: made now, or the one the app already used.
      let eid = made.find((b) => !b.edge && !b[INTEGRATION])!.entity.eid
      let [b] = await read(`.entity.eid=${eid}&.${CONNECTION}&*`)
      let [l] = await read(
        `.entity.eid=${edgeEid(app.eid, USES, eid)}&.${USES}&*`,
      )
      let status = comp(b, CONNECTION).status
      let u = comp(l, USES)
      if (u.each) {
        let at = `https://${space.slug}.${apex(ctx.env)}/${app.slug}`
        return {
          space,
          text: `${space.slug}/${app.slug} asks each person to connect their ` +
            `own ${integrationOf(b)}: link them to ${at}/api/connections/` +
            `${encodeURIComponent(integrationOf(b))}, where the platform ` +
            `draws the Connect button. The page reads their sentinel as ` +
            `${u.binding} from ./api/env and sends the call through ` +
            './api/fetch?url=…; only they call out through it.',
        }
      }
      if (status == 'connected') {
        await rebind(ctx.env, storeName(space, app), app.eid)
      }
      return {
        space,
        text: `${space.slug}/${app.slug} ${said(u, 'worker.js')}. ` +
          (status == 'connected'
            ? `It is connected, and env.${u.binding} answers now.`
            : `It is not connected yet: the person pastes the key or signs ` +
              `in at ${
                pageOf(ctx.env, space.slug)
              } — never in this chat — and ` +
              `env.${u.binding} answers from then on.`) +
          (u.direct ? '' : ` Send env.${u.binding} wherever the service ` +
            'wants its key (a header, the query, the body); it is swapped for ' +
            'the key on the way out, only to the hosts the connection names.') +
          (u.anyone ? '' : ' Only a member of the app may call out ' +
            'through it until the person opens it to anyone on that page.'),
      }
    },
  },
  {
    name: 'connection_list',
    readOnly: true,
    input: {
      type: 'object',
      properties: { space: SPACE },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let all = await invokePackage(ctx, 'connection_list', {
        space: space.slug,
        owner: space.eid,
      })
      let titles = new Map(
        (await ctx.dir.apps(space)).map((a) => [a.eid, a.slug]),
      )
      let rows = all.filter((b) => b[CONNECTION]).map((b) => {
        let c = comp(b, CONNECTION)
        let uses = all.filter((l) => comp(l, 'edge').to == b.entity.eid)
          .map((l) =>
            said(
              comp(l, USES),
              titles.get(String(comp(l, 'edge').from)) ?? 'another app',
            )
          )
        return `${c.integration} (${b.entity.eid}): ${c.status}${
          c.account ? ` as ${c.account}` : ''
        }${uses.length ? `; ${uses.join('; ')}` : ''}`
      })
      return {
        space,
        text: rows.length
          ? `${rows.join('\n')}\n\nThe person connects each at ` +
            `${pageOf(ctx.env, space.slug)}. No key is ever shown.`
          : `${space.slug} has no connections. connection_need says what ` +
            'an app needs.',
      }
    },
  },
]

let BUILDERS: Row[] = [{
  name: 'builder_choose',
  destructive: true,
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      output: str('the output take to use'),
    },
    required: ['app', 'output'],
  },
  run: async (ctx, args) => {
    let { space, app } = await inApp(ctx, args, true)
    let made = await invokePackage(ctx, 'builder_choose', {
      space: space.slug,
      app: app.slug,
      output: text(args.output, 'output'),
    })
    let output = answer(made)
    return {
      space,
      text: `chosen ${output} in ${space.slug}/${app.slug}`,
      value: { output },
    }
  },
}, {
  name: 'builder_build',
  destructive: true,
  openWorld: true,
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      builder: str("the builder's id or alias"),
      only: {
        type: 'array',
        items: { type: 'string' },
        description: 'build only the bindings whose outer entities these ' +
          'name (ids or aliases), and leave the other builds as they are',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: 'build only the first n bindings, and leave the other ' +
          'builds as they are',
      },
      rebuild: { type: 'boolean', description: 'redo every selected binding' },
      outdated: {
        type: 'boolean',
        description: 'redo selected bindings built under an older definition',
      },
      template: str(
        "a content.body template to try instead of the builder's own, as a " +
          'shadow variant',
      ),
      provider: str(
        "a provider to try instead of the builder's own, as a shadow variant",
      ),
      input: {
        type: 'object',
        description: 'native request fields merged into sending.input for a ' +
          'shadow variant',
      },
      model: str(
        "a model to try instead of the builder's own, as a shadow variant",
      ),
    },
    required: ['app', 'builder'],
  },
  run: async (ctx, args) => {
    let { space, app } = await inApp(ctx, args, true)
    let ask: Ask = {
      builder: text(args.builder, 'builder'),
      rebuild: args.rebuild == true,
      outdated: args.outdated == true,
      ...args.only == null
        ? {}
        : { only: (args.only as unknown[]).map(String) },
      ...args.limit == null ? {} : { limit: Number(args.limit) },
      ...args.template == null ? {} : { template: String(args.template) },
      ...args.provider == null ? {} : { provider: String(args.provider) },
      ...args.model == null ? {} : { model: String(args.model) },
      ...args.input == null ? {} : { input: args.input as Ask['input'] },
    }
    let made = await invokePackage(ctx, 'builder_build', {
      space: space.slug,
      app: app.slug,
      ...ask,
    })
    let result = answer(made)
    let builds = result.endsWith(' has no matching bindings')
      ? []
      : result.split('\n').filter(Boolean)
    return {
      space,
      text: builds.length
        ? `reconciled ${builds.length} build${builds.length == 1 ? '' : 's'} ` +
          `of ${ask.builder} in ${space.slug}/${app.slug}; each asks its ` +
          `tool only for changed inputs or explicitly requested redos:\n${
            builds.join('\n')
          }`
        : `${ask.builder} has no matching bindings in ${space.slug}/${app.slug}`,
      value: { builds },
    }
  },
}, {
  name: 'builder_supply',
  destructive: true,
  input: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      builder: str("the builder's id or alias"),
      for: str('the first entity of exactly one outer binding, as id or alias'),
      slot: { type: 'string', minLength: 1 },
      artifact: str('an existing artifact in this app store, as id or alias'),
      args: {
        type: 'object',
        description: 'recorded prompt, model, loudness audit or other ' +
          'provenance kept on the supplied call',
      },
    },
    required: ['app', 'builder', 'for', 'slot', 'artifact'],
  },
  run: async (ctx, args) => {
    let { space, app } = await inApp(ctx, args, true)
    let ask: Supply = {
      builder: text(args.builder, 'builder'),
      for: text(args.for, 'for'),
      slot: text(args.slot, 'slot'),
      artifact: text(args.artifact, 'artifact'),
      ...args.args == null ? {} : { args: args.args as Supply['args'] },
    }
    let made = await invokePackage(ctx, 'builder_supply', {
      space: space.slug,
      app: app.slug,
      ...ask,
    })
    let output = answer(made)
    return {
      space,
      text: `supplied ${ask.slot} of ${ask.builder} in ` +
        `${space.slug}/${app.slug}, spending nothing: ${output}`,
      value: { output },
    }
  },
}]

/** The translations, worded: answered on the connector door beside `TOOLS`,
 * and unlisted. */
export let PUBLISHED: Tool[] = [...ROWS, ...MEMORY, ...CONNECTIONS, ...BUILDERS]
  .map(worded)

/**
 * The listing's `mail_send`, onto @yaks/mail's own (listed as
 * `store_mail_send`): the subject was called `title`, and the answer was the
 * letter alone, as bundles rather than words. Unlisted, like the rest.
 */
export let sending = (ctx: Ctx): NamedTool => ({
  name: 'mail_send',
  description: 'store_mail_send, with its subject called title',
  applied: true,
  inputSchema: {
    type: 'object',
    properties: {
      space: SPACE,
      app: APP,
      to: str('an email address, or the id of a record with email{address}'),
      title: str('the subject line'),
      body: str('the body, as markdown'),
    },
    required: ['app', 'to', 'title', 'body'],
  },
  run: async (asked) => {
    let { title, ...args } = argsOf(asked)
    let made = await invokePackage(ctx, 'mail_send', {
      ...args,
      to: text(args.to, 'to'),
      subject: text(title, 'title'),
      body: text(args.body, 'body'),
    })
    let letter = made.find((b) => b.mail)
    if (!letter) throw new Error('the letter was not written')
    return [letter]
  },
})
