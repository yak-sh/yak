import { description, feedback } from '@yaks/feedback'
import { RECEIPT, submit, type Support } from '@yaks/feedback/hosted'
import { line } from '@yaks/query'
import { replyTo, url as hostUrl } from '@yaks/platform/host'
import { within } from '@yaks/workerd/rate'
import { url } from './directory.ts'
import { caught, failing } from './defects.ts'
import { opened, seal } from './lib/token.ts'
import { meta } from './meta.ts'
import { EITHER } from './preauth.ts'
import { VERSION } from './running.ts'
import { titling, vouched } from './session.ts'
import {
  adding,
  asking,
  lately,
  link,
  open,
  opens,
  read,
  signer,
  type Thread,
  title,
  transcript,
  valueOf,
} from './support.ts'
import {
  apart,
  type Args,
  asCaller,
  type Ctx,
  ownSpace,
  SPACE,
  text,
} from './tool.ts'
import type { Row } from './tool-words.ts'

let location = async (ctx: Ctx, args: Args) => {
  if (!ctx.person) return { space: null, app: null }
  let at: Args = { app: args.app }
  apart(at)
  let named = at.space ?? args.space
  let space = named != null
    ? await ctx.dir.space(text(named, 'space'))
    : await ownSpace(ctx, at.app).catch((e) => {
      caught(e, { tool: 'feedback' })
      return null
    })
  let app = space && at.app != null
    ? await ctx.dir.app(space, text(at.app, 'app'))
    : null
  return { space, app }
}

let receipt = (secret: string) => ({
  seal: async (eid: string) =>
    `${RECEIPT}${await seal('feedback', { eid }, secret)}`,
  open: async (key: string) =>
    (await opened<{ eid: string }>(
      'feedback',
      key.slice(RECEIPT.length),
      secret,
    ))?.eid ?? null,
})

let support = (ctx: Ctx, args: Args): Support<Thread> => {
  let { dir, env, person } = ctx
  let store = meta(env)
  let headers = async () => ({
    ...vouched(asCaller(ctx, null)),
    ...await titling(dir, person),
  })
  let evidence = {
    person: person || null,
    session: ctx.who?.instrument ?? null,
    call: ctx.call ?? null,
    agent: ctx.who?.agent ?? null,
  }
  return {
    signedIn: !!person,
    login: hostUrl(env, '/login'),
    email: replyTo(env),
    receipt: env.SESSION_SECRET ? receipt(env.SESSION_SECRET) : undefined,
    read: (eid) => read(store, eid),
    opens: async (thread) => {
      let narrowed = ctx.who?.spaceEid ??
        (ctx.who?.space
          ? (await dir.space(ctx.who.space))?.eid ?? ctx.who.space
          : null)
      return await opens(thread, asking(dir, person, narrowed))
    },
    recent: async (adding) => {
      if (adding) return await lately(store, person)
      try {
        return (await store.query(
          line`.report&.created.by=${person}&.report.at>=1-hour-ago`,
        )).length
      } catch (e) {
        caught(e, { tool: 'feedback' })
        return 0
      }
    },
    within: () =>
      within(env.FEEDBACK_RATE, ctx.source ?? '', failing('rate limit')),
    add: async (thread, words) => {
      await adding(
        store,
        env,
        dir,
        thread,
        { words, ...evidence },
        await headers(),
      )
      return (await read(store, thread.eid))!
    },
    open: async (words, yak) => {
      let { space, app } = await location(ctx, args)
      let at = new Date().toISOString()
      let me = await signer(dir, person)
      let where = app && space
        ? `${space.slug}/${app.slug}${app.version ? ` v${app.version}` : ''}`
        : space?.slug ?? ''
      let eid = await open(store, env, { words, ...evidence }, {
        app: app?.eid ?? null,
        space: space?.eid ?? null,
        version: app?.version ?? null,
        release: VERSION,
        yak,
        at,
      }, {
        subject: `feedback: ${title(words)}`,
        lines: [
          me.from,
          ...where ? [`space ${where}`] : [],
          ...app && space ? [url(space, app, env)] : [],
          ...yak ? [`yak ${yak}`] : [],
          `yaks.app ${VERSION} · ${at}`,
        ],
        ...me.to ? { to: me.to } : {},
      }, await headers())
      return { thread: (await read(store, eid))!, where }
    },
    answer: (thread, lead, receipt) => ({
      text: `${lead}\n\n${transcript(thread, person)}` +
        (receipt
          ? `\n\nKeep this private receipt to read replies with yak feedback --thread '${receipt}'`
          : person
          ? `\n\nRead it again with feedback(thread: '${thread.eid}'), or at ${
            link(env, thread.eid)
          }`
          : ''),
      value: { ...valueOf(thread, env), ...receipt ? { receipt } : {} },
    }),
  }
}

/** Hosted feedback uses the platform's existing support store and mail. */
export let hostedFeedback: Row = {
  name: feedback.name,
  slots: { feedback: description },
  destructive: feedback.destructive,
  openWorld: feedback.openWorld,
  security: EITHER,
  input: {
    ...feedback.input,
    properties: {
      ...feedback.input.properties,
      space: SPACE,
      yak_version: {
        type: 'string',
        description: 'The yak release sending this feedback.',
      },
    },
  },
  run: (ctx, args) => submit(support(ctx, args), args),
}
