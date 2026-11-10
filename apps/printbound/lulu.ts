// Lulu's wire adapter. HTTP and credential sentinels are supplied by the app;
// quoting never submits a job. https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml
import { InputError } from './refusal.ts'

export type Address = {
  name: string
  street1: string
  street2?: string
  city: string
  state_code?: string
  country_code: string
  postcode: string
  phone_number: string
  email?: string
}

export type Print = {
  title: string
  contact: string
  pages: number
  package: string
  quantity: number
  address: Address
  shipping: string
  currency: string
}

export type Files = { interior: string; cover: string }
export type Receipt = {
  id: string
  reference: string
  status: string
  changed: string
  message: string
  tracking: string[]
}
export type Cost = {
  currency: string
  subtotal: number
  tax: number
  total: number
  shipping: number
}
export type Lookup = { found: Receipt } | { absent: true }
export type Printer = {
  quote: (input: Print) => Promise<Cost>
  find: (reference: string) => Promise<Lookup>
  submit: (reference: string, print: Print, files: Files) => Promise<Receipt>
  status: (id: string) => Promise<Receipt>
  cancel: (id: string) => Promise<void>
}

type Json = Record<string, unknown>
type Wire = {
  id?: string | number
  external_id?: string
  status?: { name?: string; changed?: string; message?: string }
  line_items?: { tracking_urls?: string[] }[]
  items?: { tracking_urls?: string[] }[]
  count?: number
  results?: Wire[]
  currency?: string
  total_cost_excl_tax?: string
  total_tax?: string
  total_cost_incl_tax?: string
  shipping_cost?: { total_cost_excl_tax?: string }
  name?: string
}
export class ProviderError extends Error {}

export let cents = (value: unknown): number => {
  if (typeof value != 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new ProviderError('Lulu returned an invalid monetary amount')
  }
  let amount = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(amount)) {
    throw new ProviderError('Lulu amount exceeds supported precision')
  }
  return amount
}

let receipt = (body: Wire): Receipt => {
  if (body.id == null || !body.status?.name || !body.external_id) {
    throw new ProviderError('Lulu returned an incomplete print receipt')
  }
  return {
    id: String(body.id),
    reference: body.external_id,
    status: body.status.name,
    changed: body.status.changed ?? '',
    message: body.status.message ?? '',
    tracking: (body.line_items ?? body.items ?? []).flatMap((item) =>
      item.tracking_urls ?? []
    ),
  }
}

export let validPrint = (input: Print) => {
  if (
    !Number.isSafeInteger(input.quantity) || input.quantity < 1 ||
    !Number.isSafeInteger(input.pages) || input.pages < 1 || !input.package ||
    !input.shipping || !input.currency || !input.title || !input.contact
  ) throw new InputError('Incomplete print specification')
  let a = input.address
  if (
    ![a.name, a.street1, a.city, a.country_code, a.postcode].every((s) =>
      typeof s === 'string' && s.trim()
    ) ||
    typeof a.phone_number !== 'string' ||
    !/^\+?[\d\s\-./()]{8,20}$/.test(a.phone_number)
  ) {
    throw new InputError(
      'A complete shipping address and phone number are required',
    )
  }
  return input
}

let lines = (
  input: Print,
) => [{
  page_count: input.pages,
  pod_package_id: input.package,
  quantity: input.quantity,
}]
let destination = (input: Print) => ({
  shipping_address: input.address,
  shipping_level: input.shipping,
})

/** Credentials may be platform sentinels; only outbound fetch resolves them. */
export let lulu = (config: {
  key: string
  secret: string
  base: 'https://api.sandbox.lulu.com' | 'https://api.lulu.com'
  fetch: typeof fetch
}): Printer => {
  let call = async (
    path: string,
    method = 'GET',
    body?: Json,
  ): Promise<Wire> => {
    let token = await config.fetch(
      `${config.base}/auth/realms/glasstree/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.key,
          client_secret: config.secret,
        }),
      },
    )
    if (!token.ok) {
      throw new ProviderError(`Lulu authentication failed (${token.status})`)
    }
    let auth = await token.json()
    if (!auth.access_token) {
      throw new ProviderError('Lulu authentication returned no token')
    }
    let response = await config.fetch(`${config.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${auth.access_token}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      throw new ProviderError(
        `Lulu ${method} ${path.split('?')[0]} failed (${response.status})`,
      )
    }
    return response.json()
  }
  let find = async (reference: string): Promise<Lookup> => {
    let seen = 0, count: number | undefined, matches: Receipt[] = []
    for (let page = 1;; page++) {
      let query = new URLSearchParams({
        search: reference,
        page: String(page),
        page_size: '100',
      })
      let body = await call(`/print-jobs/?${query}`)
      if (
        typeof body.count !== 'number' || !Number.isSafeInteger(body.count) ||
        body.count < 0 || !Array.isArray(body.results) ||
        (count !== undefined && count !== body.count)
      ) throw new ProviderError('Lulu lookup returned inconsistent results')
      count = body.count
      seen += body.results.length
      matches.push(
        ...body.results.filter((job) => job.external_id === reference).map(
          receipt,
        ),
      )
      if (seen >= count!) break
      if (!body.results.length) {
        throw new ProviderError(
          'Lulu lookup returned an incomplete result set',
        )
      }
    }
    if (seen !== count || matches.length > 1) {
      throw new ProviderError('Lulu lookup returned ambiguous results')
    }
    return matches.length ? { found: matches[0] } : { absent: true }
  }
  return {
    find,
    quote: async (input) => {
      validPrint(input)
      let body = await call('/print-job-cost-calculations/', 'POST', {
        line_items: lines(input),
        ...destination(input),
        currency: input.currency,
      })
      if (!body.currency) {
        throw new ProviderError('Lulu quote returned no currency')
      }
      let result = {
        currency: body.currency,
        subtotal: cents(body.total_cost_excl_tax),
        tax: cents(body.total_tax),
        total: cents(body.total_cost_incl_tax),
        shipping: cents(body.shipping_cost?.total_cost_excl_tax),
      }
      if (
        result.currency?.toUpperCase() !== input.currency.toUpperCase() ||
        result.total !== result.subtotal + result.tax || result.total <= 0 ||
        result.shipping > result.subtotal
      ) {
        throw new ProviderError('Lulu quote currency or totals disagree')
      }
      return result
    },
    submit: async (reference, input, files) => {
      validPrint(input)
      let body = await call('/print-jobs/', 'POST', {
        external_id: reference,
        contact_email: input.contact,
        line_items: [{
          title: input.title,
          quantity: input.quantity,
          printable_normalization: {
            pod_package_id: input.package,
            page_count: input.pages,
            interior: { source_url: files.interior },
            cover: { source_url: files.cover },
          },
        }],
        ...destination(input),
      })
      let result = receipt(body)
      if (result.reference !== reference) {
        throw new ProviderError('Lulu returned a different order reference')
      }
      return result
    },
    status: async (id) =>
      receipt(await call(`/print-jobs/${encodeURIComponent(id)}/`)),
    cancel: async (id) => {
      let body = await call(
        `/print-jobs/${encodeURIComponent(id)}/status/`,
        'PUT',
        { name: 'CANCELED' },
      )
      if (body.name !== 'CANCELED') {
        throw new ProviderError('Lulu did not confirm cancellation')
      }
    },
  }
}
