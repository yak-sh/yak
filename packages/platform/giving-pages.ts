import { createElement as h, type ReactNode } from 'react'
import { Card, Notice } from '@yaks/ui/parts'
import { bodyOf, holding } from '@yaks/blob'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { type Line, line } from '@yaks/query'
import {
  type Choice,
  type Fund,
  fundOf,
  NOTHING_GIVEN,
  priceOf,
  type Rates,
  suggested,
} from './giving.ts'
import { donorForm, fundForm, reviewForm, totalsView } from './giving-view.ts'

type Store = {
  read: (line: Line) => Promise<Bundle[]>
  write: (rows: Bundle[]) => Promise<unknown>
}

type Page = {
  title: string
  lead?: string
  status?: number
  controls?: boolean
}

type Giving = {
  request: Request
  store: Store
  link: string
  provider: string
  mode: 'test' | 'live' | undefined
  connected: (test: boolean) => Promise<boolean>
  rates: Rates
  page: (page: Page, ...parts: ReactNode[]) => Response
}

let form = async (request: Request) => {
  if (!request.body) return null
  let body = await holding(bodyOf(request), 4096)
  if (body instanceof Uint8Array) {
    return new URLSearchParams(new TextDecoder().decode(body))
  }
  await body.stream.cancel()
  return null
}

let move = (location: string) =>
  new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'private, no-store' },
  })

let named = (row: Bundle) => ({
  eid: row.entity.eid,
  fund: fundOf(row as Parameters<typeof fundOf>[0]),
})

let isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id)

let funds = async (store: Store, id?: string | null) => {
  let rows = id
    ? isId(id)
      ? await store.read(line`.entity.eid=${id}&.fund&?doc&?fund_receipt`)
      : []
    : await store.read(line`.fund&?doc&?fund_receipt&.order=doc.title`)
  return rows.map(named)
}

let chosen = (fund: Fund, body: URLSearchParams | null): Choice => ({
  amount: body?.get('amount') ??
    (fund.amounts[0] == null ? '' : (fund.amounts[0] / 100).toFixed(2)),
  monthly: body?.get('frequency') == 'month',
  cover: body?.get('cover') == 'on',
  key: body?.get('key') || mint(),
})

export let givingPage = async (
  at: Giving,
  checkout: (body: Record<string, unknown>) => Promise<Response>,
) => {
  let { request, store, rates, mode, provider } = at
  let url = new URL(request.url)
  let body = request.method == 'POST' ? await form(request) : null
  let [row] = await funds(
    store,
    body?.get('fund') ?? url.searchParams.get('fund'),
  )
  if (!row) return at.page({ title: 'Fund unavailable', status: 404 })
  let { fund, eid } = row
  let route = url.pathname
  let urlFor = new URL(at.link)
  urlFor.searchParams.set('fund', eid)
  let test = fund.test || mode == 'test'
  let available = await at.connected(test)
  let draw = (part: ReactNode, status = 200) =>
    at.page({
      title: fund.title,
      lead: test ? 'Test giving page. No money will move.' : 'Make a donation',
      controls: true,
      status,
    }, part)
  if (request.method != 'POST' && url.searchParams.has('returned')) {
    return draw(
      h(
        Card,
        null,
        'If your payment completed, a receipt will arrive by email.',
      ),
    )
  }
  let fields = chosen(fund, body)
  let edit = (error?: string, status = 200) =>
    draw(
      donorForm(fund, eid, route, fields, rates, provider, available, error),
      status,
    )
  if (!available) {
    return edit(
      test
        ? 'Test checkout opens when a sandbox account is connected.'
        : 'This fund is currently closed to payments.',
      body ? 409 : 200,
    )
  }
  if (request.method != 'POST') return edit()
  if (!body || !isId(fields.key)) return edit('Enter your gift again.', 400)
  let priced = priceOf(fields, rates)
  if ('refused' in priced) return edit(priced.refused, 400)
  let { charge } = priced
  if (
    body.get('act') != 'checkout' || body.get('priced') != String(charge.total)
  ) {
    return draw(
      reviewForm(route, eid, fields, charge.total, charge.covered, provider),
    )
  }
  let cancel = urlFor.href
  urlFor.searchParams.set('returned', '1')
  let response = await checkout({
    ...priced.asked,
    fund: eid,
    key: fields.key,
    success: urlFor.href,
    cancel,
  })
  let result = await response.json() as {
    url?: string
    error?: { message?: string }
  }
  return response.ok && result.url ? move(result.url) : edit(
    result.error?.message ?? 'Checkout is unavailable. Try again later.',
    response.status,
  )
}

let yearOf = (text: string | null, today: number) => {
  let year = Number(text)
  return Number.isInteger(year) && year >= 2020 && year <= today ? year : today
}

let totals = async (store: Store, year: number) => {
  let from = `${year}-01-01T00:00:00.000Z`
  let to = `${year + 1}-01-01T00:00:00.000Z`
  let gifts = await store.read(
    line`.gift.at>=${from}&.gift.at<${to}&.fields=gift.test,gift.total_cents`,
  )
  let live = { gifts: 0, cents: 0 }, test = { gifts: 0, cents: 0 }
  for (let row of gifts) {
    let gift = row.gift as Comp
    let tally = gift.test ? test : live
    tally.gifts++
    tally.cents += Number(gift.total_cents ?? 0)
  }
  return { live, test }
}

export let donationSettings = async (
  at: Giving,
  manage: string,
  now: number,
  letters: (year: number) => Promise<Response>,
) => {
  let { request, store, rates } = at
  let path = new URL(request.url).pathname
  let configured = await funds(store)
  let today = new Date(now).getUTCFullYear()
  let year = yearOf(new URL(request.url).searchParams.get('year'), today)
  let canLive = at.mode == 'live' && await at.connected(false)
  let view = async (say?: string, status = 200) => {
    let { live, test } = await totals(store, year)
    return at.page(
      {
        title: 'Donations',
        lead: 'Set up a fund and see what it received.',
        status,
      },
      h('p', null, h('a', { href: manage }, 'Back to Selling')),
      say ? h(Notice, { role: 'status' }, say) : null,
      configured.map(({ fund, eid }) =>
        fundForm(fund, eid, path, `${at.link}?fund=${eid}`, canLive)
      ),
      fundForm(null, '', path, at.link, canLive),
      configured.length ? totalsView(path, year, today, live, test) : null,
    )
  }
  if (request.method != 'POST') {
    return view(
      new URL(request.url).searchParams.has('saved')
        ? 'Fund saved.'
        : undefined,
    )
  }
  let body = await form(request)
  if (body?.get('act') == 'statements') {
    year = yearOf(body.get('year'), today)
    if (year >= today) return view('Choose a completed calendar year.', 400)
    let response = await letters(year)
    let { letters: count } = await response.json() as { letters?: number }
    return response.ok
      ? view(
        count ? `${count} statements queued.` : 'No new statements to send.',
      )
      : view(
        'Year-end statements are unavailable. Please try again.',
        response.status,
      )
  }
  if (body?.get('act') != 'save') {
    return view('Enter the fund details again.', 400)
  }
  let title = body.get('title')?.trim() ?? ''
  let holder = body.get('holder')?.trim() ?? ''
  let statement = body.get('statement')?.trim() || NOTHING_GIVEN
  let amounts = suggested(body.get('amounts') ?? '', rates.minimum)
  let eid = body.get('fund') ?? ''
  let test = body.get('mode') != 'live'
  if (!test && !canLive) {
    return view(
      'Connect your own live account before enabling live gifts.',
      409,
    )
  }
  if (eid && !configured.some((row) => row.eid == eid)) {
    return view('Fund unavailable.', 404)
  }
  if (
    !title || !holder || /[\r\n]/.test(title + holder) || title.length > 120 ||
    holder.length > 120 || statement.length > 400 || !amounts
  ) {
    return view(
      'Enter a fund name, the legal recipient, and up to six valid dollar amounts.',
      400,
    )
  }
  await store.write([{
    entity: { eid: eid || mint() },
    doc: { title },
    fund: {
      holder: null,
      statement: null,
      amounts_cents: amounts.join(','),
      test,
    },
    fund_receipt: { holder, statement },
  }])
  return move(`${path}?saved=1`)
}
