/**
 * The back office drawn in a page: a shop's orders, each order with what it
 * sold, who bought it, what else its shop keeps on it and its refunds, the
 * shop's customers, and its products, edited with the data editor's row form
 * (@yaks/data-editor/form). `shop` is the store it runs: `store(env.STORE)`
 * from `./api/client.js`, the store this app is attached to. The route is the
 * location's hash.
 *
 * @module
 */
import { facts, kinds, label } from '@yaks/data-editor'
import {
  controls,
  drawForm,
  el,
  MAX,
  notice,
  stamp,
} from '@yaks/data-editor/form'
import {
  buyer,
  cents,
  customers,
  left,
  lines,
  money,
  others,
  said,
  states,
} from './shop.js'

let ORDERS = `.order&*&.order=-created.at&.limit=${MAX}`
let PRODUCTS = `.product&?doc&.order=-created.at&.limit=${MAX}`

// What the product form says of price, where a person would type dollars.
let priced = (f) =>
  f.comp == 'product' && f.prop == 'price_cents'
    ? { ...f, label: 'Price in cents', hint: 'Whole cents: 2800 is $28.00.' }
    : f

/** Draw the back office in `root` over `shop`. `files` is the address the
 * shop's uploads are read at, `home` the shop's own address, and `uuid` makes
 * a refund's request id. */
export let open = ({ root, shop, view, files, home, uuid }) => {
  let doc = root.ownerDocument
  let h = el(doc)
  let who = shop.me()
  let defs = shop.words()
  let desk = who.then((m) => m.person ? shop.drafts({ by: m.person }) : null)
  let drawn = 0

  let paint = (...kids) => root.replaceChildren(nav(), ...kids)
  let failed = (e) => {
    paint(notice(h, e.message, true))
    if (e.status == null) throw e
  }
  let card = (head, ...kids) =>
    h(
      'section',
      { class: 'Card' },
      h('header', { class: 'Card_Head' }, ...[head].flat()),
      ...kids,
    )
  let heading = (text) => h('h2', { class: 'Card_Title' }, text)
  let back = (href, text) => h('p', {}, h('a', { href }, `← ${text}`))
  let rowsOf = (items) => h('ul', { class: 'Rows' }, items)
  let item = (href, name, ...meta) =>
    h(
      'li',
      { class: 'Rows_Item' },
      h(
        'div',
        { class: 'Rows_Main' },
        h('a', { class: 'Rows_Name', href }, name),
        h('span', { class: 'Rows_Meta' }, ...meta),
      ),
    )
  let joined = (parts) =>
    parts.filter(Boolean).flatMap((p, i) => i ? [' · ', p] : [p])
  let fact = (name, value) =>
    value == null || value === '' ? null : h(
      'div',
      { class: 'Form_Field' },
      h('span', { class: 'Form_Label' }, name),
      h('p', { class: 'Form_Value' }, value),
    )

  let nav = () => {
    let at = view.location.hash.slice(1).split('/')[0] || 'orders'
    let tab = (name, text) =>
      h('a', {
        class: 'Chip',
        href: `#${name}`,
        'aria-current': at.startsWith(name.replace(/s$/, '')) ? 'page' : null,
      }, text)
    return h(
      'nav',
      { class: 'Chips', 'aria-label': 'Back office' },
      tab('orders', 'Orders'),
      tab('customers', 'Customers'),
      tab('products', 'Products'),
    )
  }

  // Orders are the shop's editors' alone; a reader is told so, not shown an
  // empty shop.
  let editors = async () => {
    let me = await who
    if (me.writes) return true
    paint(notice(
      h,
      me.person
        ? 'Only the shop’s owners and editors see its orders.'
        : 'Sign in to see the shop’s orders.',
    ))
    return false
  }

  let orderLine = (row, words) =>
    item(
      `#order/${row.entity.eid}`,
      row.doc?.title || buyer(row).name,
      ...joined([
        money(row.order?.total_cents, row.order?.currency),
        said(row.order?.status),
        ...states(words),
        row.created?.at ? stamp(doc, row.created.at) : null,
      ]),
    )

  let orders = async (status, customer) => {
    let at = drawn
    if (!await editors()) return
    let [rows, words] = await Promise.all([shop.query(ORDERS), defs])
    if (at != drawn) return
    let shown = rows.filter((r) =>
      (!status || (r.order?.status ?? 'paid') == status) &&
      (!customer || buyer(r).key == customer)
    )
    let filter = (name, text) =>
      h('a', {
        class: 'Chip',
        href: name ? `#orders/${name}` : '#orders',
        'aria-current': (status ?? '') == name ? 'true' : null,
      }, text)
    let who = customer && shown[0] ? buyer(shown[0]).name : customer
    paint(
      customer ? back('#customers', 'Customers') : '',
      card(
        heading(customer ? who : 'Orders'),
        customer ? null : h(
          'nav',
          { class: 'Chips', 'aria-label': 'Orders by status' },
          filter('', 'All'),
          ['paid', 'partially_refunded', 'refunded', 'disputed'].map((s) =>
            filter(s, said(s))
          ),
        ),
        shown.length
          ? rowsOf(shown.map((r) => orderLine(r, others(r, words))))
          : h('p', {}, status ? 'No orders like that.' : 'No orders yet.'),
        rows.length == MAX
          ? h('p', { class: 'Form_Hint' }, `The newest ${MAX} orders.`)
          : null,
      ),
    )
  }

  let order = async (eid) => {
    let at = drawn
    if (!await editors()) return
    let [[row], products, refunds, words] = await Promise.all([
      shop.query(`id=${eid}&*`),
      shop.query(PRODUCTS),
      shop.query(`.refund_request.order=${eid}&*`),
      defs,
    ])
    if (at != drawn) return
    if (!row?.order) {
      return paint(
        back('#orders', 'Orders'),
        notice(h, 'That order is gone.', true),
      )
    }
    let o = row.order
    let cur = o.currency
    let { key, name } = buyer(row)
    let { drawValue } = controls({ doc, client: shop, kinds: [], files })
    let sold = lines(row, products)
    let extra = await Promise.all(
      others(row, words).map(async ({ name, def, held }) =>
        card(
          heading(label(name, def)),
          def.description
            ? h('p', { class: 'Card_Sub' }, def.description)
            : null,
          ...await Promise.all(
            facts(name, def).filter((f) => held[f.prop] != null).map(
              async (f, i) =>
                h(
                  'div',
                  { class: 'Form_Field' },
                  h('span', { class: 'Form_Label' }, f.label),
                  await drawValue(f, `${name}-${i}`, held[f.prop]),
                ),
            ),
          ),
        )
      ),
    )
    if (at != drawn) return
    paint(
      back('#orders', 'Orders'),
      card(
        heading(row.doc?.title || `Order from ${name}`),
        fact('Status', said(o.status)),
        fact('Bought', row.created?.at ? stamp(doc, row.created.at) : null),
        fact(
          'Customer',
          key
            ? h('a', { href: `#customer/${encodeURIComponent(key)}` }, name)
            : name,
        ),
        h(
          'ul',
          { class: 'Rows' },
          sold.map((l) =>
            h(
              'li',
              { class: 'Rows_Item' },
              h(
                'div',
                { class: 'Rows_Main' },
                l.product
                  ? h('a', {
                    class: 'Rows_Name',
                    href: `#product/${l.product}`,
                  }, l.name)
                  : h('span', { class: 'Rows_Name' }, l.name),
                h(
                  'span',
                  { class: 'Rows_Meta' },
                  ...joined([
                    `× ${l.qty}`,
                    l.cents == null ? null : money(l.cents, cur),
                  ]),
                ),
              ),
            )
          ),
        ),
        fact('Shipping', money(o.shipping_cents, cur)),
        fact('Tax', money(o.tax_cents, cur)),
        fact('Total', money(o.total_cents, cur)),
        fact(
          'Refunded',
          o.refunded_cents ? money(o.refunded_cents, cur) : null,
        ),
        fact('Our fee', o.fee_cents ? money(o.fee_cents, cur) : null),
      ),
      ...extra,
      refunding(row, refunds),
    )
  }

  // The order's refunds, and the form that asks for one: the whole of what is
  // left unless a smaller amount is typed. One request id per form, so a
  // retry asks for the same refund (docs/selling.md, Merchant refunds).
  let refunding = (row, refunds) => {
    let cur = row.order.currency
    let request = uuid()
    let note = notice(h, '')
    let tell = (text, no = false) => {
      note.textContent = text
      note.className = `Notice${no ? ' Notice-negative' : ''}`
    }
    let rest = left(row)
    let open = rest > 0 && !['refunded', 'lost'].includes(row.order.status)
    let ask = async (e) => {
      e.preventDefault()
      let form = e.target
      let typed = form.querySelector('[name="amount"]').value
      let amount = typed.trim() ? cents(typed) : rest
      if (amount == null || amount <= 0 || amount > rest) {
        return tell(`Refund an amount up to ${money(rest, cur)}.`, true)
      }
      try {
        tell('Asking for the refund…')
        await shop.pay('refunds', {
          request,
          order: row.entity.eid,
          ...amount < rest ? { amount } : {},
          reason: form.querySelector('[name="reason"]').value.trim() ||
            undefined,
        })
        route()
      } catch (err) {
        tell(err.message, true)
      }
    }
    return card(
      heading('Refunds'),
      refunds.length
        ? rowsOf(refunds.map((r) =>
          h(
            'li',
            { class: 'Rows_Item' },
            h(
              'div',
              { class: 'Rows_Main' },
              h(
                'span',
                { class: 'Rows_Name' },
                r.refund_request.amount
                  ? money(r.refund_request.amount, cur)
                  : 'What was left',
              ),
              h(
                'span',
                { class: 'Rows_Meta' },
                ...joined([
                  r.refund_request.status ?? 'requested',
                  r.refund_request.reason,
                  r.created?.at ? stamp(doc, r.created.at) : null,
                ]),
              ),
            ),
          )
        ))
        : null,
      open
        ? h(
          'form',
          { class: 'Form Page_Form', onsubmit: ask },
          h(
            'div',
            { class: 'Form_Field' },
            h('label', { class: 'Form_Label', for: 'amount' }, 'Amount'),
            h('input', {
              class: 'Field_Input',
              id: 'amount',
              name: 'amount',
              inputmode: 'decimal',
              placeholder: money(rest, cur),
            }),
            h(
              'p',
              { class: 'Form_Hint' },
              `Leave it empty to refund all ${money(rest, cur)} left.`,
            ),
          ),
          h(
            'div',
            { class: 'Form_Field' },
            h('label', { class: 'Form_Label', for: 'reason' }, 'Reason'),
            h('input', { class: 'Field_Input', id: 'reason', name: 'reason' }),
          ),
          h(
            'div',
            { class: 'Form_Actions' },
            h('button', { class: 'Button', type: 'submit' }, 'Refund'),
          ),
          note,
        )
        : refunds.length
        ? null
        : h('p', {}, 'Nothing is left to refund.'),
    )
  }

  let people = async () => {
    let at = drawn
    if (!await editors()) return
    let list = customers(await shop.query(ORDERS))
    if (at != drawn) return
    paint(card(
      heading('Customers'),
      list.length
        ? rowsOf(list.map((c) =>
          item(
            `#customer/${encodeURIComponent(c.key)}`,
            c.name,
            ...joined([
              `${c.orders} ${c.orders == 1 ? 'order' : 'orders'}`,
              money(c.spent),
              c.last ? stamp(doc, c.last) : null,
            ]),
          )
        ))
        : h('p', {}, 'Nobody has bought anything yet.'),
    ))
  }

  let productKind = async () => {
    let words = await defs
    let kind = kinds({ product: words.product }).find((k) =>
      k.name == 'product'
    )
    return { ...kind, fields: kind.fields.map(priced) }
  }

  let products = async () => {
    let at = drawn
    let [rows, me] = await Promise.all([shop.query(PRODUCTS), who])
    if (at != drawn) return
    paint(card(
      [
        heading('Products'),
        me.writes
          ? h(
            'div',
            { class: 'Card_Actions' },
            h('a', { class: 'Button Button-go', href: '#product/new' }, 'Add'),
          )
          : null,
      ],
      rows.length
        ? rowsOf(rows.map((r) =>
          item(
            `#product/${r.entity.eid}`,
            r.doc?.title || 'Untitled',
            ...joined([
              money(r.product.price_cents),
              r.product.stock == null ? null : `${r.product.stock} in stock`,
              r.product.sizes,
            ]),
          )
        ))
        : h('p', {}, 'Nothing for sale yet.'),
    ))
  }

  let product = async (eid) => {
    let at = drawn
    let [rows, me, drafts, kind] = await Promise.all([
      eid ? shop.query(`id=${eid}&*`) : [],
      who,
      desk,
      productKind(),
    ])
    if (at != drawn) return
    let row = rows[0]
    if (eid && !row) {
      return paint(
        back('#products', 'Products'),
        notice(h, 'That product is gone.', true),
      )
    }
    let form = await drawForm({
      doc,
      client: shop,
      kinds: [kind],
      kind,
      row,
      who: me,
      desk: drafts,
      files,
      done: () => view.location.hash = '#products',
      redraw: () => route(),
    })
    if (at != drawn) return
    let image = row?.product?.image
    paint(
      back('#products', 'Products'),
      card(
        heading(row ? row.doc?.title || 'Untitled' : 'New product'),
        image
          ? h('img', {
            class: 'Data_Image',
            src: new URL(image, home).href,
            alt: '',
          })
          : null,
        form,
      ),
    )
  }

  let route = () => {
    drawn++
    let [name = '', arg] = view.location.hash.slice(1).split('/')
    let drawing = name == 'order' && arg
      ? order(arg)
      : name == 'customers'
      ? people()
      : name == 'customer' && arg
      ? orders(null, decodeURIComponent(arg))
      : name == 'products'
      ? products()
      : name == 'product' && arg
      ? product(arg == 'new' ? undefined : arg)
      : orders(name == 'orders' ? arg : null)
    return drawing.catch(failed)
  }
  view.addEventListener('hashchange', route)
  return route()
}
