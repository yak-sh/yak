// A space's own numbers: finding one on offer, buying it on the platform's
// account, putting it on the space or one of its apps, giving it back, and
// the toll-free verification carriers ask before it texts. Every call goes
// through the numbers of the phone the space texts through (phones.ts
// `phoneAt`, @yaks/phone `Numbers`), so nothing here names a provider.
//
// A number bought is a `phone_line{number, via, space, upfront, monthly, at,
// verification}` row (facets/directory-vocab.ts). Where it texts from is the
// space or app row wearing it as `phone{number}`, the field every text path
// already reads, with the space's `sender{via}` beside it.
//
// Each later month a number is held is charged by a wake on its row, on the
// day of the month it was bought (facets/meter-graph.ts `lines`), and a space
// that is erased releases every number it holds (erase.ts).
import { type Numbers, shown, type TollFree } from '@yaks/phone'
import { ModelError } from '@yaks/model'
import { next } from '@yaks/wake'
import type { App, PhoneLine, Space } from './directory.ts'
import { stamp } from './directory.ts'
import type { Env } from './env.ts'
import { onHold } from './model-spend.ts'
import { phoneAt } from './phones.ts'
import {
  APP,
  type Args,
  type Ctx,
  inSpace,
  noApp,
  owns,
  refuse,
  SPACE,
  str,
  text,
} from './tool.ts'
import { type Row } from './tool-words.ts'

/** Who files a space's toll-free verification for it: the platform, as the
 * reseller carriers ask about. */
export let RESELLER = 'yaks.app'

let NUMBER = str('the number, in E.164 form, such as +18335550100')

let free = (number: string) => /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(number)

export let dollars = (n: number) => `$${n.toFixed(2)}`

/** A number's month, as the wake its row wears recurs: at the minute it was
 * bought, on that day of each month, or the 28th where a month has no such
 * day. */
export let monthly = (at: Date) =>
  `${at.getUTCMinutes()} ${at.getUTCHours()} ${
    Math.min(at.getUTCDate(), 28)
  } * *`

// The numbers of the phone a space texts through, or of the one named, and
// that phone's name.
let numbersOf = async (
  env: Env,
  chosen: Space['sender'],
): Promise<{ numbers: Numbers; via: string }> => {
  let phone = await phoneAt(env, chosen)
  let numbers = phone?.numbers?.()
  if (!phone || !numbers) {
    throw refuse(
      'unavailable',
      'No phone provider here sells numbers, so none can be bought yet.',
    )
  }
  return { numbers, via: phone.transport().via }
}

/** A number given back to the provider it was bought through, and its row
 * buried: it costs nothing from then on. */
export let released = async (env: Env, line: PhoneLine) => {
  await (await numbersOf(env, { via: line.via })).numbers.release(line.number)
  await stamp(env, { entities: [{ entity: { eid: line.eid }, tombstone: {} }] })
}

// A number the space holds, by the number the call names.
let heldBy = async (ctx: Ctx, space: Space, args: Args) => {
  let number = text(args.number, 'number')
  let line = (await ctx.dir.lines(space)).find((l) => l.number == number)
  if (!line) {
    throw refuse(
      'missing',
      `${space.slug} holds no number ${number}; number_status lists the ones it does`,
    )
  }
  return line
}

// Where a number texts from: the space, one of its apps, or nowhere yet.
let wearer = async (ctx: Ctx, number: string) =>
  await ctx.dir.textSpace(number) ?? (await ctx.dir.lined(number))?.app ?? null

let unworn = async (ctx: Ctx, number: string) => {
  let on = await wearer(ctx, number)
  if (on) {
    await stamp(ctx.env, {
      entities: [{ entity: { eid: on.eid }, phone: null }],
    })
  }
}

let where = (space: Space, apps: App[], number: string) => {
  let app = apps.find((a) => a.phone == number)
  return app
    ? `texts for ${space.slug}/${app.slug}`
    : space.sender?.number == number
    ? `texts for ${space.slug}`
    : 'not assigned yet'
}

let priced = (l: Pick<PhoneLine, 'upfront' | 'monthly'>) =>
  `${dollars(l.upfront)} up front and ${dollars(l.monthly)} a month`

// The toll-free form, from a call's arguments.
let formOf = (number: string, a: Args): TollFree => {
  let b = (a.business ?? {}) as Args
  let c = (a.contact ?? {}) as Args
  let maybe = (v: unknown, what: string) =>
    v == null ? undefined : text(v, what)
  let images = Array.isArray(a.opt_in_images) ? a.opt_in_images : []
  if (!images.length) {
    throw refuse(
      'arguments',
      'opt_in_images needs at least one picture of where people agree to texts',
    )
  }
  let ein = maybe(b.ein, 'business.ein')
  return {
    number,
    business: {
      name: text(b.name, 'business.name'),
      ...b.dba == null ? {} : { dba: text(b.dba, 'business.dba') },
      website: text(b.website, 'business.website'),
      address: {
        street: text(b.street, 'business.street'),
        ...b.street2 == null
          ? {}
          : { street2: text(b.street2, 'business.street2') },
        city: text(b.city, 'business.city'),
        state: text(b.state, 'business.state'),
        zip: text(b.zip, 'business.zip'),
      },
      entity: text(
        b.entity,
        'business.entity',
      ) as TollFree['business']['entity'],
      ...ein
        ? { registration: { number: ein, type: 'EIN', country: 'US' } }
        : {},
    },
    contact: {
      first: text(c.first, 'contact.first'),
      last: text(c.last, 'contact.last'),
      email: text(c.email, 'contact.email'),
      phone: text(c.phone, 'contact.phone'),
    },
    useCase: text(a.use_case, 'use_case'),
    summary: text(a.summary, 'summary'),
    sample: text(a.sample, 'sample'),
    volume: text(a.volume, 'volume'),
    optIn: text(a.opt_in, 'opt_in'),
    optInImages: images.map((u, i) => text(u, `opt_in_images[${i}]`)),
    ...Object.fromEntries(
      ([
        'confirmation',
        'help',
        'keywords',
        'privacy',
        'terms',
        'more',
      ] as const)
        .flatMap((k) => a[k] == null ? [] : [[k, text(a[k], k)]]),
    ),
    reseller: RESELLER,
  }
}

let ENTITIES = [
  'sole_proprietor',
  'private_profit',
  'public_profit',
  'non_profit',
  'government',
]

/** The number tools, worded in tools.yml. */
export let numberTools: Row[] = [
  {
    name: 'number_find',
    readOnly: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        toll_free: {
          type: 'boolean',
          description: 'toll-free numbers only (the default); false for local',
        },
        area: str('a three-digit area code, for a local number'),
        contains: str('digits the number should contain'),
        limit: {
          type: 'number',
          description: 'at most this many (5 by default)',
        },
      },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let offers = await (await numbersOf(ctx.env, space.sender)).numbers.find({
        tollFree: args.toll_free !== false,
        ...args.area == null ? {} : { area: text(args.area, 'area') },
        ...args.contains == null
          ? {}
          : { contains: text(args.contains, 'contains') },
        limit: Math.min(Number(args.limit ?? 5) || 5, 20),
      })
      if (!offers.length) {
        return { text: 'No number on offer matches that.', space }
      }
      return {
        text:
          offers.map((o) =>
            `${o.number} ${shown(o.number)} — ${priced(o)}` +
            (o.sms ? '' : ', no texts')
          ).join('\n') +
          `\n\nnumber_buy buys one for ${space.slug}, from its budget.`,
        space,
      }
    },
  },
  {
    name: 'number_buy',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, number: NUMBER },
      required: ['number'],
    },
    run: async (ctx, args) => {
      let { space } = await owns(ctx, args)
      let number = text(args.number, 'number')
      let { numbers, via } = await numbersOf(ctx.env, space.sender)
      let [offer] = await numbers.find({ number, tollFree: free(number) })
      if (!offer) {
        throw refuse(
          'missing',
          `${number} is not on offer; number_find lists what is`,
        )
      }
      if (offer.currency != 'USD') {
        throw refuse('arguments', `${number} is priced in ${offer.currency}`)
      }
      // The row first: its unique number decides who gets it before anything
      // is spent, and a purchase the provider refuses takes it back out.
      let eid = crypto.randomUUID()
      let now = new Date()
      let every = monthly(now)
      await stamp(ctx.env, {
        entities: [{
          entity: { eid },
          phone_line: {
            number,
            via,
            space: space.eid,
            upfront: offer.upfront,
            monthly: offer.monthly,
            at: now.toISOString(),
          },
          wake: {
            every,
            at: next(every, now.getTime()),
            note: `Charge ${space.slug} a month of ${number}`,
          },
        }],
      })
      let cost = offer.upfront + offer.monthly
      try {
        let bought = await onHold(
          ctx.env,
          space,
          cost,
          'texts',
          async (spent) => {
            let it = await numbers.buy(number)
            spent(cost)
            return it
          },
        )
        return {
          text:
            `Bought ${shown(number)} for ${space.slug}: ${priced(offer)}, ` +
            `${dollars(cost)} of it from this month's budget.` +
            (bought.status == 'pending'
              ? ' The provider is still putting it on the account.'
              : '') +
            (free(number)
              ? ' Carriers carry its texts once its toll-free verification ' +
                'is approved: number_verify files it.'
              : '') +
            ` number_assign puts it on ${space.slug} or one of its apps.`,
          space,
        }
      } catch (e) {
        await stamp(ctx.env, { entities: [{ entity: { eid }, tombstone: {} }] })
        throw e instanceof ModelError && e.code == 'limit'
          ? refuse('limit', e.message)
          : e
      }
    },
  },
  {
    name: 'number_assign',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: { space: SPACE, number: NUMBER, app: APP },
      required: ['number'],
    },
    run: async (ctx, args) => {
      let { space } = await owns(ctx, args)
      let line = await heldBy(ctx, space, args)
      let app = null
      if (args.app != null) {
        let slug = text(args.app, 'app')
        let apps = await ctx.dir.apps(space)
        app = apps.find((a) => a.slug == slug)
        if (!app) throw await noApp(ctx, space, slug, apps)
      }
      await unworn(ctx, line.number)
      await stamp(ctx.env, {
        entities: [
          app ? { entity: { eid: app.eid }, phone: { number: line.number } } : {
            entity: { eid: space.eid },
            sender: { via: line.via },
            phone: { number: line.number },
          },
        ],
      })
      let on = app ? `${space.slug}/${app.slug}` : space.slug
      return {
        text: `${on} texts from ${shown(line.number)}, and texts to it reach ` +
          `${app ? 'the app' : "the space's Operator"}. It texts only people ` +
          'who agreed to its texts.',
        space,
      }
    },
  },
  {
    name: 'number_release',
    destructive: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, number: NUMBER },
      required: ['number'],
    },
    run: async (ctx, args) => {
      let { space } = await owns(ctx, args)
      let line = await heldBy(ctx, space, args)
      await released(ctx.env, line)
      await unworn(ctx, line.number)
      return {
        text: `Released ${shown(line.number)}: it costs nothing from now on, ` +
          'and texts to it no longer arrive. A released number cannot be ' +
          'bought back for certain.',
        space,
      }
    },
  },
  {
    name: 'number_verify',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        number: NUMBER,
        business: {
          type: 'object',
          description: 'the organization that sends, as it is registered',
          properties: {
            name: str('the legal name'),
            dba: str('the name people know it by, where it differs'),
            website: str('its website'),
            street: str('street address'),
            street2: str('suite or unit'),
            city: str('city'),
            state: str('two-letter state'),
            zip: str('ZIP code'),
            entity: {
              type: 'string',
              enum: ENTITIES,
              description:
                'what kind of organization: a church is non_profit, a township government',
            },
            ein: str('its EIN'),
          },
          required: [
            'name',
            'website',
            'street',
            'city',
            'state',
            'zip',
            'entity',
          ],
        },
        contact: {
          type: 'object',
          description: 'the person carriers ask about it',
          properties: {
            first: str('first name'),
            last: str('last name'),
            email: str('email'),
            phone: str('phone, in E.164 form'),
          },
          required: ['first', 'last', 'email', 'phone'],
        },
        use_case: str(
          'what the texts are for, in the provider\'s list, such as "Religious Services", "Public Works" or "Events & Planning"',
        ),
        summary: str('what the texts are, in a sentence or two'),
        sample: str('a text exactly as it will be sent, with its STOP line'),
        volume: str('texts a month: 10, 100, 1,000, 10,000 or 100,000'),
        opt_in: str('how people agree to be texted, in words'),
        opt_in_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'URLs of pictures of where people agree',
        },
        confirmation: str('the text sent when someone opts in'),
        help: str('the answer to HELP'),
        keywords: str('the words that opt someone in, such as "START, JOIN"'),
        privacy: str('the privacy policy URL'),
        terms: str('the terms URL'),
        more: str('anything else the reviewer should know'),
      },
      required: [
        'number',
        'business',
        'contact',
        'use_case',
        'summary',
        'sample',
        'volume',
        'opt_in',
        'opt_in_images',
      ],
    },
    run: async (ctx, args) => {
      let { space } = await owns(ctx, args)
      let line = await heldBy(ctx, space, args)
      if (!free(line.number)) {
        throw refuse('arguments', `${line.number} is not toll-free`)
      }
      let filed = await (await numbersOf(ctx.env, space.sender)).numbers.verify(
        formOf(line.number, args),
      )
      await stamp(ctx.env, {
        entities: [{
          entity: { eid: line.eid },
          phone_line: { verification: filed.id },
        }],
      })
      return {
        text: `Filed the toll-free verification for ${shown(line.number)} ` +
          `(${filed.id}): ${filed.said}. Carriers review it over days; ` +
          'number_status reads where it stands.',
        space,
      }
    },
  },
  {
    name: 'number_status',
    readOnly: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, number: NUMBER },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let lines = args.number == null
        ? await ctx.dir.lines(space)
        : [await heldBy(ctx, space, args)]
      if (!lines.length) {
        return {
          text: `${space.slug} holds no number of its own; number_find lists ` +
            'what is on offer.',
          space,
        }
      }
      let apps = await ctx.dir.apps(space)
      let said = []
      for (let line of lines) {
        let state = 'no toll-free verification filed'
        if (line.verification) {
          let v = await (await numbersOf(ctx.env, space.sender)).numbers
            .verification(
              line.verification,
            )
          state = `verification ${v.status} (${v.said})` +
            (v.reason ? `: ${v.reason}` : '')
        }
        said.push(
          `${shown(line.number)} — ${where(space, apps, line.number)}; ` +
            `${priced(line)}; ` +
            (free(line.number) ? state : 'a local number'),
        )
      }
      return { text: said.join('\n'), space }
    },
  },
]
