/**
 * A space's Selling and Billing pages (`/manage/<space>/selling`,
 * `/manage/<space>/billing`), drawn from rows (./payment-rows.ts): the
 * space's plan card, where it stands with selling, whom it is billed to, its
 * month against its allowances, and on Selling the apps that may sell
 * (./side-rows.ts). The server draws them for the first paint, and the
 * browser draws them again as the rows move (./payment-browser.ts), which is
 * also where their buttons write.
 *
 * Every number is read where it is set: the platform's fee from the
 * directory, the plan's price from ./plans.ts, the provider's own fees from
 * what it publishes (@yaks/host/payments `Costs`), and the $20 sale is worked
 * from those (./fee.ts `kept`).
 *
 * @module
 */
import { createElement as h, type ReactNode as Kids } from 'react'
import {
  Button,
  Card,
  Field,
  Form,
  More,
  Notice,
  Rows,
  Table,
} from '@yaks/ui/parts'
import { day } from '@yaks/ui/relative'
import { size } from '@yaks/fp'
import type { Costs } from '@yaks/host/payments'
import { type Host, spaceHost, url } from './host.ts'
import { kept, rate } from './fee.ts'
import { BLOCK } from './meter.ts'
import {
  ceilings,
  DOMAIN_RENEWAL,
  NAMES,
  paid,
  planName,
  PRICE,
  PRO_GRANT,
  SUBSCRIBED,
  WARN,
  YEARLY,
} from './plans.ts'
import { amount } from './price.ts'
import {
  aiUse,
  beyond,
  type Ceiling,
  count,
  dollars,
  share,
} from './standing.ts'
import { heading, labeled, said, status } from './page-parts.ts'
import type {
  Allowances,
  Door,
  Payer,
  PlanCard,
  Selling,
  Want,
} from './payment-rows.ts'
import type { MarkedApp } from './routes.ts'
import type { Bundle } from '@yaks/graph'
import { allowancesOf, payerOf, planOf, sellingOf } from './payment-rows.ts'
import { appsOf } from './side-rows.ts'

/** What the page says beside the rows: whose it is, which page of which
 * space, the zone the space answers under, and what the page shows while a
 * button waits on the provider. */
export type PaymentView = {
  person: string
  view: 'selling' | 'billing'
  space: { eid: string; slug: string; title: string }
  apex: string
  loading?: string
}

/** The rows a page is drawn from. */
export type PaymentRows = {
  plan: PlanCard
  selling?: Selling
  payer?: Payer
  allowances?: Allowances
  apps: MarkedApp[]
}

/** What the rows of the space `space` a page graph holds draw; nothing until
 * its plan is in. */
export let paymentOf = (
  space: string,
  rows: Bundle[],
): PaymentRows | undefined => {
  let plan = planOf(rows)
  return plan && {
    plan,
    selling: sellingOf(rows),
    payer: payerOf(rows),
    allowances: allowancesOf(rows),
    apps: appsOf(rows, space),
  }
}

/** The page `view` says, drawn from `rows`. */
export let paymentView = (view: PaymentView, rows: PaymentRows): Kids =>
  view.view == 'selling' ? sellingPage(view, rows) : [
    planCard(view, rows.plan, rows.payer),
    rows.allowances ? allowances(view, rows.allowances) : null,
  ]

let hostOf = (view: PaymentView): Host => ({ APEX: view.apex })

// The meter's prices are whole US dollars, as on the public pricing page.
let plusPrice = () => `$${count(PRICE.plus)}`
let plusOffer = () =>
  `The Plus plan includes ${
    aiUse('plus')
  }. If it is your first paid subscription, it adds $${SUBSCRIBED} of building credit.`

// What a plan costs, said on its button: "$49 a month", "$490 a year".
let priced = (want: Want) =>
  `$${count((want.per == 'year' ? YEARLY : PRICE)[want.tier]!)} a ${want.per}`

// A button that leaves for the provider's page (./payment-browser.ts).
let leaving = (door: Door, label: string, want?: Want, quiet = false) =>
  h(Button, {
    type: 'button',
    mod: quiet ? 'quiet' : door != 'portal' && 'go',
    className: 'Bill_Go',
    'data-door': door,
    'data-plan': want?.tier,
    'data-per': want?.per,
  }, label)

// Where a card's buttons say how it went.
let saying = () => h(Notice, { className: 'Bill_Say', role: 'status' })

// The plan card (T-33125). One card: the paid plans when they are free,
// Manage billing when they are paying. Each button leaves for the page the
// provider answers, so no provider's address is written into this page.
// Each plan is offered by the month and the year only where that price
// exists.
//
// A day, not a timestamp: "runs until 14 October 2026" is what somebody wants
// to know, and the hour is noise on a monthly bill.
let planCard = (view: PaymentView, plan: PlanCard, payer?: Payer) => {
  let { tier } = plan
  let ends = plan.ends ? day(plan.ends) : ''
  let limits = ceilings(tier)!
  let allowance = tier == 'pro'
    ? `Unlimited apps, unlimited visitors, ${beyond()}, and email support`
    : `${
      limits.apps == null ? 'Unlimited apps' : `${limits.apps} apps`
    }, unlimited visitors, ${size(limits.bytes)} of app data${
      tier == 'plus' ? `, and ${aiUse(tier)}` : ''
    }`
  let env = hostOf(view)
  let host = spaceHost(env, view.space.slug)
  let head = tier == 'free'
    ? h(
      'p',
      null,
      `${host} is on the `,
      h('b', null, 'free'),
      ` plan — ${allowance}. ${plusOffer()} `,
      h('a', { href: url(env, '/pricing') }, 'Compare plans'),
      '.',
    )
    : h(
      'p',
      null,
      `${host} is on `,
      h('b', null, planName(tier)),
      ` — ${allowance}.`,
      ends ? ` It runs until ${ends} and then stops renewing.` : '',
      plan.free
        ? ` It’s free through ${day(plan.free)}: a month for each person ` +
          'you invited who built their first app. Subscribe now to keep it ' +
          'after that; nothing is charged before then.'
        : '',
    )
  // The button names the space it buys for: a plan is a space's, never the
  // person's (D-131886), and someone with two spaces pays for the one named.
  let space = view.space.title || host
  let buy = (want: Want) =>
    leaving(
      'checkout',
      `${plan.free && want.tier == 'plus' ? 'Keep' : 'Get'} ${
        planName(want.tier)
      } for ${space} — ${priced(want)}`,
      want,
    )
  // Someone the provider has met can always reach their own billing,
  // whatever plan they are on today: an invoice from a month they paid for
  // is theirs to read after they cancel. A space waiting on its first
  // invoice is offered nothing more to buy: a second subscription would bill
  // it twice.
  let open = (tier == 'free' || plan.free) && !plan.awaiting
  let doors = [
    ...(open
      ? (['plus', 'pro'] as const).flatMap((tier) =>
        plan.sold[tier].map((per) => buy({ tier, per }))
      )
      : []),
    plan.known ? leaving('portal', 'Manage billing') : null,
  ].filter(Boolean)
  // An organization that pays by check or bank transfer asks for an invoice
  // instead.
  let invoiced = plan.awaiting
    ? h(
      Form.Hint,
      null,
      'The Pro plan starts when its invoice is paid. Manage billing shows the invoice.',
    )
    : plan.invoice && open
    ? byInvoice(plan.invoice)
    : null
  // What the Pro plan adds, for every space not on it yet: a paying Plus
  // space moves to it from the billing portal.
  let more = tier == 'pro' ? null : h(
    Form.Hint,
    null,
    `The Pro plan gives ${beyond()}, and email support. Taking it adds ` +
      `$${PRO_GRANT} of building credit once.`,
    tier == 'plus' && plan.known ? ' Switch to it from Manage billing.' : '',
  )
  // Where the Pro plan has no price yet, a free space still hears how to get
  // it: the pricing page offers it everywhere.
  let ask = tier == 'free' && !plan.sold.pro.length
    ? h(
      Form.Hint,
      null,
      'The Pro plan is not on sale here yet. Email ',
      h('a', { href: 'mailto:hello@yaks.app' }, 'hello@yaks.app'),
      ' to start on it.',
    )
    : null
  return h(
    Card,
    { className: 'Bill', id: 'plan' },
    heading('Plan', {
      status: tier == 'free' ? status('Free') : status(NAMES[tier], 'positive'),
      actions: doors.length ? doors : null,
    }),
    head,
    billedLine(plan, payer),
    h(Form.Hint, null, DOMAIN_RENEWAL),
    plan.credit ? credit(plan.credit, space) : null,
    invoiced,
    more,
    ask,
    saying(),
  )
}

// The plan card's invoice (T-163754): the Pro plan for a year, invoiced to
// the address typed here and paid by bank transfer or check. Nothing leaves
// for the provider's page: the invoice follows by email, and the plan starts
// when it is paid.
let byInvoice = (due: number) =>
  h(
    More,
    null,
    h(More.Summary, null, 'Pay by invoice instead'),
    h(
      More.Body,
      null,
      h(
        Form,
        { className: 'Page_Form', 'data-invoice': '' },
        labeled(
          'invoice-email',
          'Send the invoice to',
          h(Field, {
            id: 'invoice-email',
            placeholder: 'billing@example.org',
            name: 'email',
            type: 'email',
            autocomplete: 'email',
            required: true,
          }),
          `For an organization that pays by check or bank transfer: ${
            planName('pro')
          } for a year, ${
            priced({ tier: 'pro', per: 'year' })
          }, due ${due} days after each invoice is sent. The plan starts when the first invoice is paid, and each year's invoice comes as the year turns.`,
        ),
        labeled(
          'invoice-name',
          'Made out to',
          h(Field, {
            id: 'invoice-name',
            placeholder: 'e.g. Oak Street Church',
            name: 'name',
            maxlength: 200,
            autocomplete: 'organization',
          }),
          'Your organization’s name, as the invoice should show it.',
        ),
        h(Button, { type: 'submit', mod: 'go' }, 'Send the invoice'),
        said(),
      ),
    ),
  )

// The plan card's AI credit (D-134567): past its monthly budget a space
// spends credit bought in blocks, up to the cap its owner types here, which
// is $0 until they choose one. The cap joins the page's Save bar; the block
// leaves for the provider's checkout.
let credit = (c: NonNullable<PlanCard['credit']>, space: string) =>
  h(
    Form,
    { className: 'Page_Form', method: 'post', 'data-save': 'credit-cap' },
    labeled(
      'credit-cap',
      'Monthly cap on AI credit',
      h(
        Form.Line,
        null,
        h(Field, {
          id: 'credit-cap',
          placeholder: 'e.g. 25',
          name: 'cap',
          type: 'number',
          min: 0,
          step: 1,
          inputmode: 'numeric',
          value: c.cap,
          required: true,
        }),
        c.buy ? leaving('credit', `Buy $${BLOCK} of credit`) : null,
      ),
      c.cap
        ? `Past its monthly AI budget, ${space} spends credit you buy in $${BLOCK} blocks, never more than ${
          dollars(c.cap)
        } a month. ${dollars(c.left)} is left to spend this month, and ${
          dollars(c.drawn)
        } spent. Credit not spent carries to next month.`
        : `Past its monthly AI budget, ${space} can spend credit you buy in $${BLOCK} blocks, up to a monthly cap in dollars you choose here. Nothing is ever charged past it.`,
    ),
  )

// Whom the plan is billed to, where the payment provider has met the space:
// the address its receipts go to, or, when the provider has no payer to say
// or couldn't be asked just now, only that it bills the space. A space the
// provider never met is billed to nobody.
let billedLine = (plan: PlanCard, payer?: Payer) => {
  if (!plan.known) {
    return plan.tier == 'free' ? h(Form.Hint, null, 'Nothing is billed.') : null
  }
  let through = plan.provider ? ` through ${plan.provider}` : ''
  return payer?.email
    ? h(
      'p',
      null,
      'Billed to ',
      h('b', null, payer.email),
      payer.name ? ` (${payer.name})` : '',
      `${through}. Manage billing changes the card, the address and who receives the receipts.`,
    )
    : h(
      'p',
      null,
      `Billed${through}. Manage billing shows the card and the receipts.`,
    )
}

// Each allowance as the Billing page names it, how its figures read, and what
// a person needs to know about counting it.
let ALLOWANCES: [Ceiling, string, (n: number) => string, string][] = [
  ['apps', 'Apps', count, ''],
  [
    'requests',
    'Request units',
    count,
    'Visitors are always served, past it too.',
  ],
  ['bytes', 'App data', size, ''],
  ['files', 'Photos and files', size, ''],
  ['emails', 'Emails', count, 'Sent and received.'],
  [
    'seconds',
    'Compute seconds',
    count,
    'The sandbox, and compiling at deploy.',
  ],
]

// One allowance as a row: its name, how much of it is used, and, from four
// fifths of it, how it stands.
let gaugeRow = (name: string, figure: string, hint: string, part: number) =>
  h(
    Rows.Item,
    { as: 'li' },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { as: 'span' }, name),
      h(Rows.Meta, null, figure, hint ? ` · ${hint}` : ''),
    ),
    part >= 1
      ? status('At the limit', 'negative')
      : part >= WARN
      ? status('Near the limit', 'negative')
      : null,
  )

// The Billing page's month (T-131895): every allowance the space answers to
// and how much of it is used, with its budget for models and voice.
let allowances = (view: PaymentView, month: Allowances) => {
  let rows = ALLOWANCES.filter(([what]) => month.limits[what])
    .map(([what, name, read, hint]) => {
      let g = month.limits[what]!
      // Request units are read by the hourly sweep, so before its first
      // reading of the month there is no figure, and zero would be a claim.
      let figure = what == 'requests' && !month.read
        ? `None counted yet this month, of ${read(g.limit)}`
        : `${read(g.used)} of ${read(g.limit)}`
      return gaugeRow(name, figure, hint, g.used / g.limit)
    })
  let { spent, limit } = month.budget
  let read = month.read ? `, last read at ${month.read.slice(11, 16)} UTC` : ''
  return h(
    Card,
    null,
    heading('This month'),
    h(
      Card.Sub,
      null,
      `What ${
        spaceHost(hostOf(view), view.space.slug)
      } has used since the 1st, counted hourly${read}. Each starts again on the 1st, except what the space holds.`,
    ),
    h(
      Rows,
      { as: 'ul' },
      rows,
      gaugeRow(
        'Models and voice',
        `${share(spent, limit)} used`,
        'Your Operator’s and your apps’ models and voices, from this space’s budget.',
        limit ? spent / limit : 0,
      ),
    ),
  )
}

// Selling (T-34524): a space starts taking payments in its apps here, so the
// page says what selling is and what every part of it costs before the
// button is pressed.
let sellingPage = (view: PaymentView, rows: PaymentRows) => {
  let at = rows.selling
  if (!at) return h('p', null, 'Selling is not available here yet.')
  let by = at.provider
  let paying = paid(rows.plan.tier)
  let ready = at.state == 'ready'
  let connected = at.state != 'none'
  let stop = ready || (!paying && connected)
  let account = stop
    ? h(
      Button,
      { type: 'button', 'data-sell-stop': '' },
      `Disconnect ${by}`,
    )
    : leaving(
      'start',
      at.state == 'setup' ? 'Continue setup' : `Create a ${by} account`,
    )
  // A new account is the way most people take; one they already have is
  // offered under it.
  let existing = paying && at.linkable
    ? h(
      Form.Hint,
      null,
      `Already have a ${by} account? `,
      leaving(
        'link',
        at.state == 'setup' ? 'Connect it instead' : 'Connect it',
        undefined,
        true,
      ),
    )
    : null
  // The card that starts selling, with the lead under the first one only.
  let start = (title: string, lead?: Kids) =>
    h(
      Card,
      { className: 'Bill' },
      heading(title, {
        status: ready
          ? status('Connected', 'positive')
          : at.state == 'setup'
          ? status('Setup unfinished', 'negative')
          : null,
        actions: paying ? account : leaving(
          'checkout',
          `Subscribe — ${plusPrice()} a month`,
          { tier: 'plus', per: 'month' },
        ),
      }),
      lead,
      existing,
      saying(),
    )
  return [
    start(
      ready ? 'Payments are connected' : 'Sell from your apps',
      [leadOf(at, paying), !paying ? h(Form.Hint, null, plusOffer()) : null],
    ),
    h(
      Card,
      null,
      heading('Donations'),
      h(
        Card.Sub,
        null,
        'Set up one-time and monthly gifts through your connected account.',
      ),
      rows.apps.length
        ? h(
          'ul',
          null,
          rows.apps.map((app) =>
            h(
              'li',
              null,
              h('a', {
                href: `https://${
                  spaceHost({ APEX: view.apex }, view.space.slug)
                }/${app.slug}/api/pay/donations`,
              }, `Donations for ${app.title || app.slug}`),
            )
          ),
        )
        : h('p', null, 'Create an app to add a donation fund.'),
    ),
    offered(by, rows.apps),
    at.costs ? costing(view, at, paying, at.costs) : null,
    // Once the costs are read, the button is at hand again rather than a
    // scroll back up.
    ready ? null : start(
      !paying
        ? 'Start selling on the Plus plan'
        : at.state == 'setup'
        ? `Finish setting up ${by}`
        : 'Start selling',
    ),
  ]
}

// What the first card says under its title, for where the space stands.
let leadOf = (at: Selling, paying: boolean) => {
  let by = at.provider
  return h(
    'p',
    null,
    at.house
      ? `This space sells on yaks.app’s own ${by} account, as the house, so no yaks.app fee is taken.`
      : at.state == 'ready'
      ? `Payments go to your ${by} account, and ${by} pays them into your bank. You manage refunds and disputes in your ${by} dashboard.`
      : !paying && at.state != 'none'
      ? `Your ${by} account is connected. Upgrade to the Plus plan to take new payments.`
      : at.state == 'setup'
      ? `Finish connecting your ${by} account to start taking payments.`
      : `Your apps can take card payments, and ${by} pays the money into your bank account.${
        paying
          ? ''
          : ` Selling comes with the Plus plan, ${plusPrice()} a month.`
      }`,
  )
}

// A row of facts: what it is, and a line that says more.
let fact = (name: Kids, meta: Kids) =>
  h(
    Rows.Item,
    { as: 'li' },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { as: 'span' }, name),
      h(Rows.Meta, null, meta),
    ),
  )

// The space's apps by name, as one phrase: a few, and how many more.
let appsNamed = (apps: MarkedApp[]) => {
  let names = apps.map((a) => a.title || a.slug)
  let shown = names.length > 4
    ? [...names.slice(0, 3), `${names.length - 3} more`]
    : names
  return new Intl.ListFormat('en', { type: 'conjunction' }).format(shown)
}

// What a space can sell, and how a sale reaches the seller.
let offered = (by: string, apps: MarkedApp[]) => [
  h(
    Card,
    null,
    heading('What you can sell'),
    h(
      Card.Sub,
      null,
      apps.length
        ? `Every app in this space can take payments: ${appsNamed(apps)}.`
        : 'Every app you make in this space can take payments.',
    ),
    h(
      Rows,
      { as: 'ul' },
      fact(
        'Things with a price',
        'An app lists what it sells, each with a price, and with sizes or stock where it has them. A buyer can put several in one cart, with a flat shipping rate.',
      ),
      fact(
        'Work priced per order',
        'An app can price each order on its own, with its shipping and tax, the way a book printed to order is priced.',
      ),
      fact(
        'Paid once',
        'Each sale is one payment. Subscriptions aren’t offered yet.',
      ),
    ),
  ),
  h(
    Card,
    null,
    heading('How a sale reaches you'),
    h(
      Rows,
      { as: 'ul' },
      fact(
        `The buyer pays on ${by}’s page`,
        `Your app sends them to a ${by} checkout page to pay by card. Their card number never reaches your app or yaks.app.`,
      ),
      fact(
        'You get the order',
        'The order shows up in your app, and the buyer gets a receipt by email from it.',
      ),
      fact(
        `${by} pays you`,
        'The money, less the fees below, goes into your bank account.',
      ),
      fact(
        'You look after your buyers',
        `You deliver what you sold and answer your buyers. Refunds and disputes are in your ${by} dashboard. Your bank details and ID go to ${by}, and yaks.app never sees them.`,
      ),
    ),
  ),
]

// Cents as a person reads a fee: `30¢`, `$15`, or `$0.88` in a sum.
let small = (cents: number) => cents < 100 ? `${cents}¢` : amount(cents)
let usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

// The sale the costs are worked through.
let EXAMPLE = 2000

// Every cost of selling, and a sale worked through them.
let costing = (
  view: PaymentView,
  at: Selling,
  paying: boolean,
  costs: Costs,
) => {
  let by = at.provider
  let env = hostOf(view)
  // The house's sales are the platform's own, which pays itself nothing.
  let bps = at.house ? 0 : at.fee
  let card = `${rate(costs.card.bps)} + ${small(costs.card.cents)}`
  let sale = kept(EXAMPLE, bps, costs.card)
  let line = (name: Kids, value: string) =>
    h(
      Table.Row,
      null,
      h(Table.Cell, null, name),
      h(Table.Cell, { mod: 'num' }, value),
    )
  return h(
    Card,
    null,
    heading('What it costs'),
    h(
      Rows,
      { as: 'ul' },
      paying ? null : fact(
        `The Plus plan: ${plusPrice()} a month`,
        `Selling comes with the ${NAMES.plus} and ${NAMES.pro} plans.`,
      ),
      fact(`${by}: ${card} a payment`, [
        `On a card from the ${costs.country}. A card from another country adds ${
          rate(costs.abroad)
        }. Rates in other countries are on `,
        h(
          'a',
          { href: costs.pricing, target: '_blank', rel: 'noopener' },
          `${by}’s pricing page`,
        ),
        '.',
      ]),
      fact(
        bps
          ? `yaks.app: ${rate(bps)} of each sale`
          : 'yaks.app: nothing per sale',
        bps
          ? 'Taken from the same payment. Nothing else is charged per sale.'
          : 'yaks.app takes no cut of your sales.',
      ),
      fact(
        'Payouts',
        `${by} pays into your bank about ${costs.payout.days} days after each sale. Your first payout comes about ${costs.payout.first} days after your first sale.`,
      ),
      fact(
        'Refunds',
        (costs.refunded
          ? `${by} gives its fee back on a refund.`
          : `${by} keeps its fee on a refunded payment.`) +
          (bps ? ' yaks.app gives its fee back.' : ''),
      ),
      fact(
        `Disputes: ${small(costs.dispute)}`,
        `If a buyer disputes a charge with their bank, ${by} charges you ${
          small(costs.dispute)
        }, and gives it back if you win.`,
      ),
      fact(
        'Sales tax',
        'Checkout adds no sales tax: the buyer pays the price your app shows. Any sales tax you owe is yours to pay.',
      ),
    ),
    h(Card.Title, { as: 'h3' }, `A ${amount(EXAMPLE)} sale`),
    h(
      Table,
      { cols: [null, 'num'] },
      h(
        Table.Body,
        null,
        line('The buyer pays', usd(EXAMPLE)),
        line(`${by}’s fee, ${card}`, `−${usd(sale.provider)}`),
        line(`yaks.app’s fee, ${rate(bps)}`, `−${usd(sale.platform)}`),
        line(h('b', null, 'Reaches your bank'), usd(sale.seller)),
      ),
    ),
    h(
      Form.Hint,
      null,
      'The same fee is on the ',
      h(
        'a',
        { href: url(env, '/pricing'), target: '_blank', rel: 'noopener' },
        'pricing page',
      ),
      ', and the ',
      h(
        'a',
        { href: url(env, '/terms'), target: '_blank', rel: 'noopener' },
        'terms',
      ),
      ' say what selling asks of you.',
    ),
  )
}
