import { recovery } from './recovery.js'
let desk = document.querySelector('#desk'),
  notice = document.querySelector('#notice')
let book = null,
  pages = [],
  settings = null,
  queued = Promise.resolve(),
  saving = null,
  pageId = null,
  recovering
let freshId = () => {
  let id = location.hash.split('/')[1]
  if (!/^[a-f0-9-]{36}$/i.test(id ?? '')) {
    id = crypto.randomUUID()
    history.replaceState(null, '', '#new/' + id)
  }
  return id
}
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
        'That could not finish. Your saved pages are kept.',
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
let select = (name, title, values, value) =>
  `<label class="Field"><span>${title}</span><select class="Field_Control" name="${name}">${
    values.map(([id, name]) =>
      `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${
        esc(name)
      }</option>`
    ).join('')
  }</select></label>`
let file = (blob) => './studio/file?id=' + book.entity.eid + '&blob=' + blob
let edition = (document) =>
  document
    ? `<section class="Panel"><h2>Review your complete print document</h2><p>PrintBound composed these pages. They are the same files attached to checkout, including the cover and blank leaves.</p><div class="Preview">${
      document.pages.map((page) =>
        `<figure class="Page"><img class="Page_Image" src="${
          file(page.blob)
        }" alt="${esc(page.role)} ${page.number}"><figcaption class="Caption">${
          esc(page.role)
        } · page ${page.number}</figcaption></figure>`
      ).join('')
    }</div><a href="${
      file(document.interior.blob)
    }" target="_blank" rel="noopener">Open interior PDF</a> · <a href="${
      file(document.cover.blob)
    }" target="_blank" rel="noopener">Open cover PDF</a></section>`
    : ''
let save = () => {
  let input = Object.fromEntries(
      new FormData(desk.querySelector('[data-source]')),
    ),
    id = pageId,
    existing = book?.entity.eid
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
let pageCard = (page) =>
  `<li class="Panel"><form data-page="${page.entity.eid}"><h3>Page ${page.coloring_page.position}${
    page.coloring_page.activity
      ? ' · ' + esc(page.coloring_page.activity.replaceAll('_', ' '))
      : ''
  }</h3>${
    page.artwork
      ? (page.artwork.mime === 'application/pdf'
        ? `<object class="Page_Image" data="${
          file(page.artwork.blob)
        }" type="application/pdf"><a href="${
          file(page.artwork.blob)
        }">Open puzzle PDF</a></object>`
        : `<img class="Page_Image" src="${
          file(page.artwork.blob)
        }" alt="Completed artwork for page ${page.coloring_page.position}">`)
      : '<p>Artwork has not been drawn yet.</p>'
  }<p class="Caption">${
    page.page_drawing
      ? 'Drawing this page. Earlier completed artwork is kept.'
      : page.page_failed
      ? esc(page.page_failed.message)
      : page.artwork
      ? 'Completed artwork saved.'
      : 'Ready to draw.'
  }</p>${field('prompt', 'Scene to draw', page.coloring_page.prompt, true)}${
    field('caption', 'Story sentence', page.coloring_page.caption)
  }<div class="Actions"><button>Save page</button><button type="button" data-act="retry" data-page="${page.entity.eid}">Redraw this page</button><button type="button" data-act="up" data-page="${page.entity.eid}">Move up</button><button type="button" data-act="down" data-page="${page.entity.eid}">Move down</button>${
    page.artwork
      ? `<a href="./studio/printable?id=${book.entity.eid}&page=${page.entity.eid}">Free printable PDF</a>`
      : ''
  }</div></form></li>`
let destination = () =>
  `<form data-destination><h2>Print a copy with PrintBound</h2><p>PrintBound is the seller. You pay PrintBound once; CrayonBloom adds no second print charge.</p>${
    field('name', 'Recipient name')
  }${field('street1', 'Street address')}${
    field('street2', 'Apartment or unit (optional)')
  }${field('city', 'City')}${field('state_code', 'State or region')}${
    field('postcode', 'Postal code')
  }${field('country_code', 'Country code', 'US')}${
    field('phone_number', 'Delivery phone')
  }<label class="Field"><span>Copies</span><input class="Field_Control" name="quantity" type="number" min="1" value="1"></label>${
    select('shipping', 'Shipping', [
      ['MAIL', 'Standard'],
      ['GROUND', 'Ground'],
      ['EXPEDITED', 'Expedited'],
    ], 'MAIL')
  }<button>Get destination quote</button></form>`
let receipt = () => {
  let quote = book.print_quote?.quote, receipt = book.print_receipt?.receipt
  return `${
    quote
      ? `<h2>${
        quote.preview ? 'Simulated PrintBound quote' : 'Your PrintBound quote'
      }</h2><p>Seller: PrintBound<br>Total including delivery and tax: ${
        esc(
          new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: quote.currency,
          }).format(quote.total / 100),
        )
      }<br>${esc(quote.shipping.name)} · Valid until ${
        esc(new Date(quote.expires).toLocaleString())
      }</p><button data-act="purchase">${
        quote.preview
          ? 'Simulate print purchase'
          : 'Continue to PrintBound checkout'
      }</button>`
      : ''
  }${
    receipt
      ? `<h2>${
        receipt.preview ? 'Simulated print receipt' : 'Your print receipt'
      }</h2><p>Seller: PrintBound<br>${
        receipt.preview ? 'Simulated progress' : 'Provider-confirmed progress'
      }: ${esc(receipt.status)}</p>${
        receipt.checkout
          ? `<a class="Action" href="${
            esc(receipt.checkout)
          }">Open secure checkout</a>`
          : ''
      }${
        (receipt.tracking ?? []).map((link) =>
          `<p><a href="${esc(link)}">Track shipment</a></p>`
        ).join('')
      }<div class="Actions"><button data-act="progress">Refresh progress</button><button data-act="cancel">Request cancellation</button></div>`
      : ''
  }`
}
let draw = () => {
  recovering.unbind()
  let s = book?.coloring_book ?? {}, document = book?.print_review?.document
  desk.innerHTML = `<a href="#">← Your shelf</a>${
    settings.preview
      ? '<p class="Caption">Fixture preview · artwork and story suggestions are demonstrations. No model calls, payments or print orders run.</p>'
      : ''
  }<h1 class="Title">${
    esc(book?.doc.title ?? 'Make something they can color')
  }</h1><div class="Grid"><section class="Panel"><form data-source>${
    field('title', 'Book title', book?.doc.title)
  }${field('prompt', 'Your idea', s.prompt, true)}${
    select('mode', 'Make a', [['story', 'Story coloring book'], [
      'coloring',
      'Coloring book',
    ], ['free', 'Free coloring page']], s.mode ?? 'story')
  }${
    select('age', 'Age range', [['2-4', 'Ages 2–4'], ['4-8', 'Ages 4–8'], [
      '8-12',
      'Ages 8–12',
    ], ['13+', 'Ages 13 and up']], s.age ?? '4-8')
  }${
    select(
      'style',
      'Art style',
      settings.styles.map((style) => [style.entity.eid, style.doc.title]),
      s.style ?? settings.styles[0]?.entity.eid,
    )
  }${field('character', 'Character appearance (optional)', s.character)}${
    field(
      'personalization',
      'First name on the book (optional)',
      s.personalization,
    )
  }${
    field('dedication', 'Dedication (optional)', s.dedication)
  }<p class="Caption">Your idea and edits are saved. Finished artwork stays on your shelf if drawing is interrupted.</p><div class="Actions"><button>Save idea</button><button type="button" data-act="story">Suggest a story</button></div></form></section><section class="Panel"><h2>Your editable story</h2><p>Edit the story a paragraph at a time. Each paragraph becomes one scene when you choose Use story as pages.</p><label class="Field"><textarea class="Field_Control Field_Area" name="body" data-story-text>${
    esc(book?.doc.body ?? '')
  }</textarea></label><div class="Actions"><button data-act="outline">Use story as pages</button><button data-act="draw">Draw or resume saved pages</button></div>${
    book?.page_failed
      ? `<p>${
        esc(book.page_failed.message)
      }</p><button data-act="retry_character">Retry character sheet</button>`
      : ''
  }${
    book
      ? `<h3>Add a puzzle</h3><div class="Actions"><button data-act="puzzle" data-kind="maze">Maze</button><button data-act="puzzle" data-kind="connect_the_dots">Dot-to-dot</button>${
        s.age !== '2-4'
          ? '<button data-act="puzzle" data-kind="word_search">Word search</button>'
          : ''
      }</div><h3>Prepare for print</h3><button data-act="connect">Connect PrintBound</button><button data-act="prepare">Prepare print document</button><p class="Caption">You review the complete document before requesting a destination quote.</p>`
      : ''
  }</section></div>${
    pages.length
      ? `<h2>Your saved pages</h2><ol class="Shelf">${
        pages.map(pageCard).join('')
      }</ol>`
      : ''
  }${edition(document)}${
    document
      ? `<div class="Grid"><section class="Panel">${destination()}</section><section class="Panel">${receipt()}</section></div>`
      : ''
  }${
    book
      ? `<section class="Panel"><label><input type="checkbox" data-gallery ${
        book.gallery_consent ? 'checked' : ''
      }> I consent to this book’s artwork being considered for the public gallery.</label><p class="Caption">Sharing is optional and requires review. This does not subscribe you to marketing mail.</p></section>`
      : ''
  }`
  recovering.bind(desk.querySelector('[data-source]'), 'book:' + pageId)
  recovering.field(
    desk.querySelector('[data-story-text]'),
    'book:' + pageId + ':body',
  )
  for (let form of desk.querySelectorAll('[data-page]')) {
    recovering.bind(form, 'page:' + form.dataset.page)
  }
  let destinationForm = desk.querySelector('[data-destination]')
  if (destinationForm) recovering.bind(destinationForm, 'shipping:' + pageId)
}
let sourceInput = () => {
  let form = desk.querySelector('[data-source]'),
    body = desk.querySelector('[data-story-text]')
  if (!form || !body) return
  let hidden = form.querySelector('[name=body]')
  if (!hidden) {
    hidden = document.createElement('input')
    hidden.type = 'hidden'
    hidden.name = 'body'
    form.append(hidden)
  }
  hidden.value = body.value
}
let open = async () => {
  if (saving != null && desk.querySelector('[data-source]')) {
    clearTimeout(saving)
    saving = null
    sourceInput()
    save().catch((error) => tell(error.message))
  }
  settings ??= await request('settings')
  if (location.hash.startsWith('#new')) {
    pageId = freshId()
    book = null
    pages = []
    draw()
    return
  }
  if (location.hash.startsWith('#book/')) {
    pageId = location.hash.slice(6)
    let value = await request('book?id=' + encodeURIComponent(pageId))
    book = value.book
    pages = value.pages
    draw()
    return
  }
  let shelf = await request('shelf')
  recovering.unbind()
  pageId = null
  desk.innerHTML = `${
    settings.preview
      ? '<p class="Caption">Fixture preview · no paid generation, payment or print fulfillment.</p>'
      : ''
  }<h1 class="Title">Your personal shelf</h1><p>Start with your child’s idea. Save a page, build a story, or gather completed pages into a book.</p><div class="Actions"><a class="Action" href="#new">Start an idea</a></div><ul class="Shelf">${
    shelf.map((book) =>
      `<li><a class="Shelf_Link" href="#book/${book.entity.eid}"><h2>${
        esc(book.doc.title)
      }</h2><p>${
        book.print_receipt
          ? 'Print receipt saved'
          : book.print_review
          ? 'Ready for document review'
          : 'Saved idea and pages'
      }</p></a></li>`
    ).join('')
  }</ul>`
}
desk.addEventListener('input', (event) => {
  if (
    !event.target.closest('[data-source]') &&
    !event.target.matches('[data-story-text]')
  ) return
  sourceInput()
  clearTimeout(saving)
  tell('Saving…')
  saving = setTimeout(() => {
    saving = null
    save().catch((e) => tell(e.message))
  }, 400)
})
desk.addEventListener('change', async (event) => {
  if (!event.target.matches('[data-gallery]')) return
  try {
    await request('consent', {
      id: book.entity.eid,
      agree: event.target.checked,
    })
    tell('Your gallery choice is saved.')
  } catch (e) {
    tell(e.message)
  }
})
desk.addEventListener('submit', async (event) => {
  event.preventDefault()
  clearTimeout(saving)
  try {
    if (event.target.matches('[data-source]')) {
      sourceInput()
      await save()
      return
    }
    let value = Object.fromEntries(new FormData(event.target))
    if (event.target.matches('[data-page]')) {
      await request('edit', {
        ...value,
        id: book.entity.eid,
        page: event.target.dataset.page,
      })
    } else {
      let { quantity, shipping, ...address } = value
      await request('quote', {
        id: book.entity.eid,
        quantity: Number(quantity),
        shipping,
        address,
      })
    }
    await open()
  } catch (e) {
    tell(e.message)
  }
})
desk.addEventListener('click', async (event) => {
  let button = event.target.closest('[data-act]')
  if (!button) return
  button.disabled = true
  clearTimeout(saving)
  try {
    let act = button.dataset.act
    if (['outline', 'draw', 'story', 'prepare'].includes(act)) {
      sourceInput()
      await save()
      if (!location.hash.startsWith('#book/')) {
        history.replaceState(null, '', '#book/' + book.entity.eid)
      }
    }
    if (act === 'connect') {
      let response = await fetch('./api/service/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service: settings.printer,
          operations: [
            'prepare',
            'document_status',
            'quote',
            'purchase',
            'order_status',
            'cancel',
            'document_file',
          ],
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      tell('PrintBound is connected for the operations you selected.')
      return
    }
    if (act === 'retry' && button.dataset.page) {
      let form = button.closest('[data-page]')
      await request('edit', {
        ...Object.fromEntries(new FormData(form)),
        id: book.entity.eid,
        page: button.dataset.page,
      })
    }
    if (act === 'draw' && !pages.length) {
      await request('outline', { id: book.entity.eid })
    }
    if (act === 'puzzle') {
      await request('puzzle', {
        id: book.entity.eid,
        activity: button.dataset.kind,
      })
    } else if (act === 'up' || act === 'down') {
      await request('move', {
        id: book.entity.eid,
        page: button.dataset.page,
        delta: act === 'up' ? -1 : 1,
      })
    } else {
      let result = await request(act, {
        id: book.entity.eid,
        page: button.dataset.page,
      })
      if (act === 'story' && result.pending) {
        tell('Writing a suggestion from your saved idea…')
        return pollStory()
      }
      if (act === 'prepare' && result.pending) {
        tell('Preparing composed pages…')
        await preparation(book.entity.eid)
        return
      }
      if (act === 'purchase' && result.checkout) {
        location.assign(result.checkout)
        return
      }
    }
    await open()
  } catch (e) {
    tell(e.message)
  } finally {
    button.disabled = false
  }
})
let pollStory = async () => {
  let result = await request('story', { id: book.entity.eid })
  if (result.pending) {
    setTimeout(() => pollStory().catch((e) => tell(e.message)), 1000)
    return
  }
  tell('Your suggested story is saved. Edit anything before drawing.')
  await open()
}
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
addEventListener('hashchange', () => open().catch((e) => tell(e.message)))
recovering = await recovery(
  request,
  (error) => tell(error.message || String(error)),
)
open().catch((e) => tell(e.message))
