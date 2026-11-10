import { recovery } from './recovery.js'
let account = document.querySelector('[data-account]')
account?.addEventListener('click', () => {
  let login = new URL('https://yaks.app/login')
  login.searchParams.set('return', location.href)
  account.href = login.href
})

let desk = document.querySelector('#desk'),
  notice = document.querySelector('#notice')
let esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
let request = async (name, value) => {
  let response = await fetch(
    new URL('./studio/' + name, document.baseURI),
    value
      ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      }
      : {},
  )
  let body = await response.json()
  if (!response.ok) {
    throw new Error(
      typeof body.error === 'string' ? body.error : body.error?.message ||
        'That could not finish. Your text is kept here.',
    )
  }
  return body
}
let tell = (text) => {
  notice.textContent = text
}
let field = (name, title, value = '', area = false) =>
  `<label class="Field"><span>${esc(title)}</span>${
    area
      ? `<textarea class="Field_Control Field_Area" name="${name}">${
        esc(value)
      }</textarea>`
      : `<input class="Field_Control" name="${name}" value="${esc(value)}">`
  }</label>`
let file = (id, blob) =>
  './studio/file?id=' + encodeURIComponent(id) + '&blob=' +
  encodeURIComponent(blob)
let book = null, pageId = null, recovering, opening = 0
let freshId = () => {
  let id = location.hash.split('/')[1]
  if (!/^[a-f0-9-]{36}$/i.test(id ?? '')) {
    id = crypto.randomUUID()
    history.replaceState(null, '', '#new/' + id)
  }
  return id
}
let queued = Promise.resolve()
let saving = null
let draft = () =>
  Object.fromEntries(new FormData(desk.querySelector('[data-source]')))
let save = () => {
  let input = draft(), id = pageId, existing = book?.entity.eid
  queued = queued.catch(() => {}).then(async () => {
    let saved = await request('save', {
      ...input,
      ...(existing ? { id } : { draft: id }),
    })
    if (pageId === id) {
      book = saved
      if (location.hash.startsWith('#new/')) {
        history.replaceState(null, '', '#book/' + id)
      }
      tell('Saved.')
    }
    return saved
  })
  return queued
}
let preview = (document) =>
  document
    ? `<h2>Review your print document</h2><p>These are the composed pages PrintBound will print. Check every page before checkout.</p><div class="Preview">${
      document.pages.map((page) =>
        `<figure class="Page"><img class="Page_Image" src="${
          file(book.entity.eid, page.blob)
        }" alt="${esc(page.role)} ${page.number}"><figcaption class="Caption">${
          esc(page.role)
        } · page ${page.number}</figcaption></figure>`
      ).join('')
    }</div><p><a href="${
      file(book.entity.eid, document.interior.blob)
    }" target="_blank" rel="noopener">Open interior PDF</a> · <a href="${
      file(book.entity.eid, document.cover.blob)
    }" target="_blank" rel="noopener">Open cover PDF</a></p>`
    : '<h2>Your final document</h2><p>Save your text, then prepare your book. You can review the complete document before requesting a destination quote.</p>'
let destination = () =>
  `<form data-destination><h2>Where should it go?</h2>${
    field('name', 'Recipient name')
  }${field('street1', 'Street address')}${
    field('street2', 'Apartment or unit (optional)')
  }${field('city', 'City')}${field('state_code', 'State or region')}${
    field('postcode', 'Postal code')
  }${field('country_code', 'Country code', 'US')}${
    field('phone_number', 'Delivery phone')
  }<label class="Field"><span>Copies</span><input class="Field_Control" name="quantity" type="number" min="1" max="100" value="1"></label><label class="Field"><span>Shipping</span><select class="Field_Control" name="shipping"><option value="MAIL">Standard</option><option value="GROUND">Ground</option><option value="EXPEDITED">Expedited</option></select></label><button>Get destination quote</button></form>`
let quote = (q) =>
  q
    ? `<section class="Quote"><h2>${
      q.preview ? 'Simulated PrintBound quote' : 'Your PrintBound quote'
    }</h2><p>Seller: PrintBound<br>Print, delivery and tax total: ${
      esc(
        new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: q.currency,
        }).format(q.total / 100),
      )
    }<br>Shipping: ${esc(q.shipping?.name ?? q.shipping)}<br>Valid until ${
      esc(new Date(q.expires).toLocaleString())
    }</p><p>Payment is made to PrintBound once. Your selected document stays attached to this quote.</p><button data-act="purchase">${
      q.preview ? 'Simulate print purchase' : 'Continue to PrintBound checkout'
    }</button></section>`
    : ''
let receipt = (r) =>
  r
    ? `<section class="Quote"><h2>${
      r.preview ? 'Simulated print order' : 'Your print order'
    }</h2><p>Seller: PrintBound<br>${
      r.preview ? 'Simulated progress' : 'Provider-confirmed progress'
    }: ${esc(r.status)}</p>${
      r.checkout
        ? `<a class="Action" href="${esc(r.checkout)}">Open secure checkout</a>`
        : ''
    }${
      r.tracking?.length
        ? r.tracking.map((link) =>
          `<p><a href="${esc(link)}">Track shipment</a></p>`
        ).join('')
        : ''
    }<p class="Actions"><button data-act="progress">Refresh progress</button><button data-act="cancel">Request cancellation</button></p></section>`
    : ''
let draw = () => {
  recovering.unbind()
  let s = book?.book_source ?? {}, doc = book?.book_prepared?.document
  desk.innerHTML = `<a href="#">← Your shelf</a><h1 class="Title">${
    book ? esc(book.doc.title) : 'Make a book from your words'
  }</h1><div class="Grid"><section class="Panel"><form data-source>${
    field('title', 'Book title', book?.doc.title)
  }${field('author', 'Author (optional)', s.author)}${
    field('markdown', 'Your conversation or Markdown', s.markdown, true)
  }${
    field('dedication', 'Dedication (optional)', s.dedication)
  }<p class="Caption">Your draft is saved as you edit. Headings, paragraphs, lists and emphasis become the book’s typography.</p><div class="Actions"><button type="submit">Save draft</button><button type="button" data-act="prepare">Prepare book</button></div></form></section><section class="Panel">${
    preview(doc)
  }</section></div>${
    doc
      ? `<div class="Grid"><section class="Panel">${destination()}</section><section class="Panel">${
        quote(book.book_quote?.quote)
      }${receipt(book.book_receipt?.receipt)}</section></div>`
      : ''
  }`
  recovering.bind(desk.querySelector('[data-source]'), 'book:' + pageId)
  let destinationForm = desk.querySelector('[data-destination]')
  if (destinationForm) recovering.bind(destinationForm, 'shipping:' + pageId)
}
let open = async () => {
  let turn = ++opening
  if (saving != null && desk.querySelector('[data-source]')) {
    clearTimeout(saving)
    saving = null
    save().catch((error) => tell(error.message))
  }
  if (location.hash.startsWith('#new')) {
    pageId = freshId()
    book = null
    draw()
    return
  }
  if (location.hash.startsWith('#book/')) {
    let id = location.hash.slice(6)
    let value = await request('book?id=' + encodeURIComponent(id))
    if (turn !== opening) return
    pageId = id
    book = value
    draw()
    return
  }
  let rows = await request('shelf')
  if (turn !== opening) return
  recovering.unbind()
  pageId = null
  desk.innerHTML =
    `<h1 class="Title">Your books</h1><p>Save the words you want to keep. Review a finished book before paying for print.</p><a class="Action" href="#new">Start a book</a><ul class="Shelf">${
      rows.map((row) =>
        `<li><a class="Shelf_Link" href="#book/${row.entity.eid}"><h2>${
          esc(row.doc.title)
        }</h2><p>${
          row.book_receipt
            ? 'Print order saved'
            : row.book_prepared
            ? 'Ready to review'
            : 'Saved draft'
        }</p></a></li>`
      ).join('')
    }</ul>`
}
desk.addEventListener('input', (event) => {
  if (!event.target.closest('[data-source]')) return
  clearTimeout(saving)
  tell('Saving…')
  saving = setTimeout(() => {
    saving = null
    save().catch((error) => tell(error.message))
  }, 400)
})
desk.addEventListener('submit', async (event) => {
  event.preventDefault()
  clearTimeout(saving)
  saving = null
  try {
    if (event.target.matches('[data-source]')) {
      await save()
      return
    }
    let v = Object.fromEntries(new FormData(event.target)),
      { quantity, shipping, ...address } = v
    await request('quote', {
      id: book.entity.eid,
      quantity: Number(quantity),
      shipping,
      address,
    })
    await open()
  } catch (error) {
    tell(error.message)
  }
})
desk.addEventListener('click', async (event) => {
  let button = event.target.closest('[data-act]')
  if (!button) return
  button.disabled = true
  clearTimeout(saving)
  saving = null
  try {
    let act = button.dataset.act
    if (act === 'prepare') {
      let saved = await save(), id = saved.entity.eid
      let result = await request('prepare', { id })
      if (result.pending) {
        tell('Preparing composed pages…')
        await preparation(id)
      } else await open()
    } else {
      let result = await request(act, { id: book.entity.eid })
      if (act === 'purchase' && result.checkout) {
        location.assign(result.checkout)
      } else await open()
    }
  } catch (error) {
    tell(error.message)
  } finally {
    button.disabled = false
  }
})
let preparation = async (id) => {
  let result = await request('preparation', { id })
  if (result.pending) {
    setTimeout(
      () => preparation(id).catch((error) => tell(error.message)),
      1000,
    )
    return
  }
  if (pageId === id) await open()
}
addEventListener(
  'hashchange',
  () => open().catch((error) => tell(error.message)),
)
recovering = await recovery(
  request,
  (error) => tell(error.message || String(error)),
)
open().catch((error) => tell(error.message))
