// The tool list a directory published, and the translations that keep it
// answering (M-37853).
//
// A directory snapshots `tools/list` when a connector is submitted and serves
// that snapshot to everyone who installs it from there; only `tools/call`
// reaches us. So every name in the listing answers, with the arguments it was
// listed with, until a new listing is released. A tool renamed or dropped
// since is kept here as a translation onto what does its work now, and only
// the connector door lists one (agent.ts `platform`): the builder, which no
// directory lists, never sees them.
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
import type { Bundle, Comp } from '@yaks/graph'
import { ctxOf, rebind } from './connections.ts'
import { storeName } from './directory.ts'
import { CWD, TIMEOUT } from './sandbox.ts'
import { vaulted } from './vault.ts'
import {
  APP,
  inApp,
  refuse,
  type Row,
  SPACE,
  str,
  text,
  type Tool,
  worded,
} from './tool.ts'
import { call } from './tools.ts'

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
      await rebind(ctx.env, storeName(space, app), app.eid)
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
      await rebind(ctx.env, storeName(space, app), app.eid, [name])
      return { space, text: `${space.slug}/${app.slug}: ${name} removed` }
    },
  },
]

/** The translations, worded: listed on the connector door beside `TOOLS`. */
export let PUBLISHED: Tool[] = ROWS.map(worded)
