// A space's own numbers: finding one on offer, buying it on the platform's
// account, putting it on the space or one of its apps, giving it back, and
// the toll-free verification carriers ask before it texts. Every call goes
// through the numbers of a phone config.ts `phoneConfig` lends (@yaks/phone
// `Numbers`): the one whose `sells` names the kind of number, local or
// toll-free, so nothing here names a provider. A space pays the provider's
// price and our markup (@yaks/platform/numbers `numberPrice`), and each
// minute a number's calls take as its provider charged them, with our share
// (number-upkeep.ts).
//
// A number bought is a `phone_line{number, via, space, upfront, monthly, at,
// verification, sms, voice, campaign}` row (facets/directory-vocab.ts), which
// says what the number is approved for (@yaks/platform/numbers `uses`): calls, texts to people who
// know it, and texts to many once its toll-free verification or 10DLC
// campaign stands. Where it texts from is the space or app row wearing it as
// `phone{number}`, the field every text path already reads, with the
// space's `sender{via}` beside it. A provider that sends each number's texts
// to a URL of its own, as voip.ms does, is given `/<via>/<ticket>` here, the
// ticket the kernel's seal on the number (number-door.ts).
//
// Each later month a number is held is charged by a wake on its row, on the
// day of the month it was bought (@yaks/platform/meter-graph `lines`), and a
// space that is erased releases every number it holds (erase.ts).
import { type Numbers, type Offer, shown, type TollFree } from '@yaks/phone'
import { numberPrice, uses } from '@yaks/platform/numbers'
import { manageAt } from '@yaks/platform/routes'
import { ModelError } from '@yaks/model'
import { Unsent } from '@yaks/host/senders'
import { next } from '@yaks/wake'
import {
  type App,
  type Directory,
  directoryOf,
  type PhoneLine,
  type Space,
  stamp,
} from './directory.ts'
import { requested } from './confirm.ts'
import type { Env } from './env.ts'
import { reserved, settled } from './model-spend.ts'
import { phoneNamed, phones } from './phones.ts'
import { callbackOf } from './number-door.ts'
import {
  APP,
  type Args,
  type Ctx,
  inSpace,
  noApp,
  refuse,
  SPACE,
  str,
  text,
} from './tool.ts'
import { type Row } from './tool-words.ts'
import { binnedNumber, trashedNumber } from './number-trash.ts'
import { searched, slowPhone } from './number-search.ts'
import { claimVoice, legacySeat, ownerSeats } from './number-voice.ts'
export { heldNumber, trashedNumber } from './number-trash.ts'

/** Who files a space's toll-free verification for it: the platform, as the
 * reseller carriers ask about. */
export let RESELLER = 'yaks.app'

let NUMBER = str('the number, in E.164 form, such as +18335550100')

let free = (number: string) => /^\+18(00|33|44|55|66|77|88)\d{7}$/.test(number)

export let dollars = (n: number) => `$${n.toFixed(2)}`

// An offer at our price.
let priceOf = (o: Offer): Offer => ({ ...o, ...numberPrice(o) })

type Kind = 'local' | 'toll_free'

/** A number's month, as the wake its row wears recurs: at the minute it was
 * bought, on that day of each month, or the 28th where a month has no such
 * day. */
export let monthly = (at: Date) =>
  `${at.getUTCMinutes()} ${at.getUTCHours()} ${
    Math.min(at.getUTCDate(), 28)
  } * *`

// The phone that sells this kind of number: its numbers and its name.
let sellerOf = async (env: Env, kind: Kind) => {
  for (let [via, phone] of Object.entries(await phones(env))) {
    if (!phone.transport().sells?.includes(kind) || phone.waiting?.()) continue
    let numbers = phone.numbers?.()
    if (numbers) return { numbers, via }
  }
  throw refuse(
    'unavailable',
    `No phone provider here sells ${
      kind == 'local' ? 'local' : 'toll-free'
    } numbers, so none can be bought yet.`,
  )
}

// The numbers of the phone a number was bought through.
let numbersOf = async (env: Env, via: string): Promise<Numbers> => {
  let numbers = (await phoneNamed(env, via))?.numbers?.()
  if (!numbers) throw new Error(`No phone provider ${via} sells numbers`)
  return numbers
}

/** Settle one order once the carrier confirms it, even after a restart. */
export let purchaseConfirmed = async (
  env: Env,
  { eid, upfront, monthly }: Pick<PhoneLine, 'eid' | 'upfront' | 'monthly'>,
  tracked: boolean,
) => {
  await settled(env, eid, upfront + monthly)
  if (!tracked) return
  await stamp(env, {
    entities: [{
      entity: { eid },
      phone_line: { ordering: null, order_reported: null },
    }],
  })
}

/** A number given back to the provider it was bought through, and its row
 * buried: it costs nothing from then on. */
export let released = async (env: Env, line: PhoneLine) => {
  let carrier = await numbersOf(env, line.via)
  if (line.ordering) {
    if (!await carrier.ordered?.(line.number)) {
      throw refuse(
        'unavailable',
        'The phone company is still confirming this order.',
      )
    }
    await settled(env, line.eid, line.upfront + line.monthly)
  }
  await carrier.release(line.number)
  await unworn(env, directoryOf(env.STORE), line.number)
  await stamp(env, { entities: [{ entity: { eid: line.eid }, tombstone: {} }] })
}

// A number the space holds, by the number the call names.
let heldBy = async (ctx: Ctx, space: Space, args: Args, trash = false) => {
  let number = text(args.number, 'number')
  let line = (await ctx.dir.lines(space)).find((l) => l.number == number)
  if (!line) {
    throw refuse(
      'missing',
      `${space.slug} holds no number ${number}; number_status lists the ones it does`,
    )
  }
  if (line.trashed && !trash) {
    throw refuse(
      'conflict',
      `${number} is in the trash; restore it on the manage page first`,
    )
  }
  if (line.ordering && !trash) {
    throw refuse(
      'unavailable',
      'The phone company is still confirming this order.',
    )
  }
  return line
}

// Where a number texts from: the space, one of its apps, or nowhere yet.
let wearer = async (dir: Directory, number: string) =>
  await dir.textSpace(number) ?? (await dir.lined(number))?.app ?? null

let unworn = async (env: Env, dir: Directory, number: string) => {
  let on = await wearer(dir, number)
  if (on) {
    await stamp(env, {
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

// A softphone's sign-in to a number the space holds, for its owner.
let signIn = async (ctx: Ctx, args: Args) => {
  let { space } = await inSpace(ctx, args, true)
  let line = await heldBy(ctx, space, args)
  let login = (await numbersOf(ctx.env, line.via)).login
  if (!line.voice || !login) {
    throw refuse(
      'unavailable',
      `${shown(line.number)} takes no calls on a softphone of its own`,
    )
  }
  let url = new URL(manageAt(space.slug, 'settings', ctx.env))
  url.searchParams.set('softphone', line.eid)
  return {
    text: `[Open your softphone sign-in for ${shown(line.number)}](${url}).`,
    space,
  }
}

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
          description: 'true for toll-free numbers; local ones by default',
        },
        area: str('a three-digit area code'),
        state: str('a two-letter state, such as MI'),
        city: str('a city or town, with its state'),
        contains: str('digits the number should contain'),
        limit: {
          type: 'number',
          description: 'at most this many (5 by default)',
        },
      },
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args)
      let tollFree = args.toll_free === true
      let maybe = (key: string) =>
        args[key] == null ? undefined : text(args[key], key)
      if (args.city != null && args.state == null) {
        throw refuse('arguments', 'Name the state the city is in (state).')
      }
      let { numbers, via } = await sellerOf(
        ctx.env,
        tollFree ? 'toll_free' : 'local',
      )
      let offers = (await searched(ctx.env, via, () =>
        numbers.find({
          tollFree,
          area: maybe('area'),
          region: maybe('state')?.toUpperCase(),
          city: maybe('city'),
          contains: maybe('contains'),
          limit: Math.min(Number(args.limit ?? 5) || 5, 20),
        }))).map(priceOf)
      if (!offers.length) {
        return { text: 'No number on offer matches that.', space }
      }
      return {
        text:
          offers.map((o) =>
            `${o.number} ${shown(o.number)}${
              o.place ? ` (${o.place})` : ''
            } — ${priced(o)}` +
            (o.sms ? '' : ', no texts') + (o.voice ? '' : ', no calls')
          ).join('\n') +
          `\n\nnumber_buy buys one for ${space.slug}, from its budget.`,
        space,
      }
    },
  },
  {
    name: 'number_buy',
    role: 'owner',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: { space: SPACE, number: NUMBER },
      required: ['number'],
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let number = text(args.number, 'number')
      let { numbers, via } = await sellerOf(
        ctx.env,
        free(number) ? 'toll_free' : 'local',
      )
      let pending = (await ctx.dir.lines(space)).find((l) =>
        l.number == number && l.ordering
      )
      if (pending) {
        let confirmed = await numbers.ordered?.(number).catch((e) => {
          if (e instanceof Unsent) return false
          throw e
        })
        if (confirmed) await purchaseConfirmed(ctx.env, pending, true)
        return {
          text: confirmed
            ? `${shown(number)} is now held for ${space.slug}.`
            : `The phone company is still confirming ${shown(number)}.`,
          space,
        }
      }
      let [found] = await searched(
        ctx.env,
        via,
        () => numbers.find({ number, tollFree: free(number) }),
      )
      let offer = found && priceOf(found)
      if (!offer) {
        // Its neighbours on offer, by its area code, to choose from instead.
        let area = /^\+1(\d{3})/.exec(number)?.[1]
        let near = area && !free(number)
          ? await numbers.find({ area, limit: 3 }).catch(() => [])
          : []
        throw refuse(
          'missing',
          `${number} is not on offer any longer` +
            (near.length
              ? `. On offer in ${area}: ` +
                near.map(priceOf).map((o) => `${o.number} (${priced(o)})`)
                  .join(', ')
              : '; number_find lists what is'),
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
      let legacy = legacySeat(await ctx.dir.read(ownerSeats(space.eid)))
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
            sms: offer.sms,
            voice: offer.voice,
            legacy_seat: legacy,
          },
          wake: {
            every,
            at: next(every, now.getTime()),
            note: `Charge ${space.slug} a month of ${number}`,
          },
        }],
      })
      let cost = offer.upfront + offer.monthly
      let release: (() => Promise<boolean>) | undefined
      let bought: Awaited<ReturnType<Numbers['buy']>>
      try {
        let hold = await reserved(
          ctx.env,
          space,
          (left) => cost <= left ? { dollars: cost } : null,
          eid,
          { what: 'texts' },
        )
        release = hold.release
        if (numbers.ordered) {
          await stamp(ctx.env, {
            entities: [{
              entity: { eid },
              phone_line: { ordering: now.toISOString() },
            }],
          })
        }
        if (numbers.login && legacy) await claimVoice(ctx.env, eid)(legacy)
        bought = await numbers.buy(number)
      } catch (e) {
        await release?.()
        await stamp(ctx.env, { entities: [{ entity: { eid }, tombstone: {} }] })
        throw e instanceof ModelError && e.code == 'limit'
          ? refuse('limit', e.message)
          : e instanceof Unsent
          ? slowPhone()
          : e
      }
      if (bought.status == 'pending' && numbers.ordered) {
        return {
          space,
          text: `The phone company is still confirming ${shown(number)}. ` +
            `${dollars(cost)} is reserved from this month's budget.`,
        }
      }
      await purchaseConfirmed(ctx.env, { ...offer, eid }, !!numbers.ordered)
      return {
        text: `Bought ${shown(number)} for ${space.slug}: ${priced(offer)}, ` +
          `${dollars(cost)} of it from this month's budget.` +
          (bought.status == 'pending'
            ? ' The provider is still putting it on the account.'
            : '') +
          (free(number)
            ? ' Carriers carry its texts once its toll-free verification ' +
              'is approved: number_verify files it.'
            : ` It is approved for ${
              uses({ ...offer, campaign: null }).join(' and ')
            }; texts to many people wait for a registered 10DLC campaign.`) +
          ` number_assign puts it on ${space.slug} or one of its apps.`,
        space,
      }
    },
  },
  {
    name: 'number_assign',
    role: 'owner',
    destructive: false,
    idempotent: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        number: NUMBER,
        app: APP,
        campaign: str(
          'the 10DLC campaign id its texts to many people are registered under, once the campaign is approved',
        ),
      },
      required: ['number'],
    },
    run: async (ctx, args) => {
      let { space } = await inSpace(ctx, args, true)
      let line = await heldBy(ctx, space, args)
      if (args.campaign != null) {
        await stamp(ctx.env, {
          entities: [{
            entity: { eid: line.eid },
            phone_line: { campaign: text(args.campaign, 'campaign') },
          }],
        })
      }
      let app = null
      if (args.app != null) {
        let slug = text(args.app, 'app')
        let apps = await ctx.dir.apps(space)
        app = apps.find((a) => a.slug == slug)
        if (!app) throw await noApp(ctx, space, slug, apps)
      }
      // Its texts come here, for a provider that sends them to a URL.
      let phone = await phoneNamed(ctx.env, line.via)
      let point = phone?.numbers?.().point
      let pending = false
      if (phone?.own && point) {
        await point(
          line.number,
          await callbackOf(ctx.env, line.via, phone.own, line.number),
        ).catch((error) => {
          // The hourly upkeep points it again (number-upkeep.ts `pointed`).
          if (!(error instanceof Unsent)) throw error
          pending = true
        })
      }
      await unworn(ctx.env, ctx.dir, line.number)
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
          'who agreed to its texts.' +
          (pending
            ? ' The phone company is still setting it to bring texts here; ' +
              'texts sent to it arrive once it has, within the hour.'
            : ''),
        space,
      }
    },
  },
  {
    // Reversible release first; only a person's confirmation returns it early.
    name: 'number_release',
    role: 'owner',
    destructive: false,
    input: {
      type: 'object',
      properties: { space: SPACE, number: NUMBER },
      required: ['number'],
    },
    run: async (ctx, args) => {
      let { space, who } = await inSpace(ctx, args, true)
      let line = await heldBy(ctx, space, args, true)
      return {
        text: line.trashed
          ? await requested(
            ctx.env,
            ctx.dir,
            space,
            ctx.person,
            trashedNumber,
            line.eid,
            line,
          )
          : await binnedNumber(ctx.env, ctx.dir, line, who),
        space,
      }
    },
  },
  {
    name: 'number_verify',
    role: 'owner',
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
      let { space } = await inSpace(ctx, args, true)
      let line = await heldBy(ctx, space, args)
      if (!free(line.number)) {
        throw refuse('arguments', `${line.number} is not toll-free`)
      }
      let filed = await (await numbersOf(ctx.env, line.via)).verify(
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
      properties: {
        space: SPACE,
        number: NUMBER,
        login: {
          type: 'boolean',
          description:
            "with number, the sign-in a softphone uses to call and take calls on it; the space owner's only",
        },
      },
    },
    run: async (ctx, args) => {
      if (args.login === true) return await signIn(ctx, args)
      let { space } = await inSpace(ctx, args)
      let lines = args.number == null
        ? await ctx.dir.lines(space)
        : [await heldBy(ctx, space, args, true)]
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
        if (line.trashed) {
          said.push(
            `${shown(line.number)} — in the trash until restored or purged; ${
              dollars(line.monthly)
            } a month; restore it on the manage page`,
          )
          continue
        }
        let state = 'no toll-free verification filed'
        let verified = false
        if (line.verification) {
          let v = await (await numbersOf(ctx.env, line.via)).verification(
            line.verification,
          )
          verified = v.status == 'verified'
          state = `verification ${v.status} (${v.said})` +
            (v.reason ? `: ${v.reason}` : '')
        }
        said.push(
          `${shown(line.number)} — ${where(space, apps, line.number)}; ` +
            `${priced(line)}; ` +
            (free(line.number) ? state : 'a local number') +
            `; approved for ${uses(line, verified).join(', ')}`,
        )
      }
      return { text: said.join('\n'), space }
    },
  },
]
