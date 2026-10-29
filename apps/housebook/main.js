import {
  apply,
  drafts,
  me,
  query,
  subscribe,
  upload,
  was,
} from './api/client.js'
import { button, el } from './dom.js'
import {
  byKind,
  everything,
  id,
  nextDue,
  searchRows,
  title,
  today,
} from './model.js'
import { view } from './views.js'
import { editor } from './editor.js'
import { documents } from './documents.js'
import { download, embedded, handover } from './export.js'

let data = byKind([])
let demo = document.documentElement.hasAttribute('data-demo')
let state = { page: 'overview', category: '', term: '', item: null }
let selected = new Set(),
  initialized = false,
  who,
  desk,
  edit,
  stop = [],
  content,
  search
let notify = (message) => {
  document.getElementById('toast').textContent = message
}
let fail = (error) => {
  notify(error.message || String(error))
  if (!error.status) globalThis.reportError?.(error)
}
let act = (fn) => async (...args) => {
  try {
    await fn(...args)
  } catch (error) {
    fail(error)
  }
}
let items = () => data.house_item
let refresh = async () => {
  data = byKind(await query(everything))
  draw()
}
let navigate = (page, category = '') => {
  state.page = page
  state.category = category
  state.item = null
  state.term = ''
  if (search) search.value = ''
  history.replaceState(
    null,
    '',
    `#${page}${category ? '/' + encodeURIComponent(category) : ''}`,
  )
  draw()
  globalThis.scrollTo?.({ top: 0, behavior: 'instant' })
}
let open = (eid) => {
  state.page = 'item'
  state.item = eid
  history.replaceState(null, '', '#item/' + eid)
  draw()
  globalThis.scrollTo?.({ top: 0, behavior: 'instant' })
}
let guards = async (kind, row, values) => {
  if (!row) return {}
  let fields = Object.keys(values).filter((k) => k !== 'title' && k !== 'body')
  return {
    $was: {
      doc: { title: await was(row.doc?.title), body: await was(row.doc?.body) },
      [kind]: Object.fromEntries(
        await Promise.all(
          fields.map(async (key) => [key, await was(row[kind]?.[key])]),
        ),
      ),
    },
  }
}
let keepDocument = documents({ upload, fetch })
let save = async (kind, row, values, file, newId) => {
  let { title: heading, body, ...props } = values
  if (kind === 'house_file') {
    props = await keepDocument(props, row?.house_file, file)
  }
  let bundle = {
    entity: { eid: id(row) || newId },
    doc: { title: heading || props.slots, body: body || '' },
    [kind]: props,
    ...await guards(kind, row, { title: heading, body, ...props }),
  }
  let result = await apply(bundle)
  if (result.pending) {
    notify(
      'Your save is queued securely and will appear when the store recovers.',
    )
    return false
  }
  notify('Saved')
  await refresh()
  return true
}
let remove = act(async (row) => {
  if (
    !confirm(`Remove “${title(row)}”? Linked files and history will be kept.`)
  ) return
  let result = await apply({ entity: { eid: id(row) }, tombstone: {} })
  notify(result.pending ? 'Removal queued.' : 'Removed')
  if (state.item === id(row)) navigate('manual')
  await refresh()
})
let complete = act(async (row) => {
  let care = row.house_care, next = nextDue(today(), care.months)
  let bundles = [{
    entity: { eid: crypto.randomUUID() },
    doc: { title: title(row), body: row.doc?.body || '' },
    house_record: { item: care.item || '', date: today(), kind: 'Maintenance' },
  }]
  bundles.push(
    next
      ? {
        entity: { eid: id(row) },
        house_care: { due: next },
        $was: { house_care: { due: await was(care.due) } },
      }
      : {
        entity: { eid: id(row) },
        tombstone: {},
        $was: { house_care: { due: await was(care.due) } },
      },
  )
  let result = await apply(bundles)
  notify(
    result.pending
      ? 'Completion queued.'
      : next
      ? 'Logged. Next reminder: ' + next
      : 'Logged in your house history.',
  )
  await refresh()
})
let exportManual = act(async (includeLogs) => {
  if (!selected.size) {
    return notify('Choose at least one item for the handover.')
  }
  notify('Preparing your portable manual…')
  let documents = data.house_file.filter((row) =>
    selected.has(row.house_file.item)
  )
  let files = await embedded(documents)
  download(
    handover(data, selected, includeLogs, files),
    'housebook-handover.html',
  )
  notify('Downloaded. Open the file to review it, or use Print → Save as PDF.')
})
let draw = () => {
  if (!initialized) {
    items().filter((r) => r.house_item.handover).forEach((r) =>
      selected.add(id(r))
    )
    initialized = true
  }
  let screens = view({
    data,
    edit,
    open,
    navigate,
    complete,
    remove,
    handover: exportManual,
    select: (eid, value) => value ? selected.add(eid) : selected.delete(eid),
    selected,
    who,
  })
  let filtered = (name) => searchRows(data[name], state.term)
  let page = {
    overview: () => screens.overview(),
    manual: () =>
      screens.manual(
        filtered('house_item').filter((r) =>
          !state.category || r.house_item.category === state.category
        ),
        state.category,
      ),
    item: () => {
      let row = items().find((r) => id(r) === state.item)
      return row
        ? screens.detail(row)
        : el('p', {}, 'This item is no longer in the manual.')
    },
    logbook: () =>
      el(
        'div',
        {},
        screens.heading(
          'The logbook',
          'A lasting record of what happened, when, and what it took.',
          screens.add('house_record', '+ Write an entry'),
        ),
        screens.logs(filtered('house_record')),
      ),
    care: () =>
      el(
        'div',
        {},
        screens.heading(
          'Care & maintenance',
          'Set the dates that fit your home. Your completed work becomes its history.',
          screens.add('house_care', '+ Add a reminder'),
        ),
        el(
          'p',
          { class: 'notice' },
          'Reminders are shown here. Email and push notifications are not enabled.',
        ),
        screens.reminders(filtered('house_care')),
      ),
    documents: () =>
      el(
        'div',
        {},
        screens.heading(
          'Documents & photos',
          'Manuals, warranties, receipts and references, kept together.',
          screens.add('house_file', '+ Add a document'),
        ),
        screens.docs(filtered('house_file')),
      ),
    electrical: () => screens.panel(filtered('house_circuit')),
    contacts: () => screens.contacts(filtered('house_contact')),
    handover: () => screens.transfer(),
  }[state.page] || (() => screens.overview())
  content.replaceChildren(page())
  document.querySelectorAll('[data-page]').forEach((node) =>
    node.classList.toggle(
      'active',
      node.dataset.page === state.page ||
        (state.page === 'item' && node.dataset.page === 'manual'),
    )
  )
  search.placeholder = ({
    manual: 'Search names, models, rooms…',
    logbook: 'Search the logbook…',
    documents: 'Search documents…',
    electrical: 'Search circuit labels…',
    contacts: 'Search contacts…',
    care: 'Search reminders…',
  })[state.page] || 'Find something in your house…'
}
let shell = () => {
  let nav = [
    ['overview', '⌂', 'Overview'],
    ['manual', '▤', 'House manual'],
    ['logbook', '≡', 'Logbook'],
    ['care', '◷', 'Care & maintenance'],
    ['documents', '▧', 'Documents'],
    ['electrical', 'ϟ', 'Electrical directory'],
    ['contacts', '♧', 'Contacts'],
    ['handover', '↗', 'Handover'],
  ]
  content = el('main', { id: 'content', tabindex: '-1' })
  search = el('input', {
    type: 'search',
    'aria-label': 'Search',
    placeholder: 'Find something in your house…',
    onInput: (event) => {
      state.term = event.target.value
      if (['overview', 'item', 'handover'].includes(state.page)) {
        state.page = 'manual'
      }
      draw()
    },
  })
  document.getElementById('app').replaceChildren(
    el(
      'aside',
      { class: 'sidebar' },
      el(
        'a',
        {
          class: 'brand',
          href: '#overview',
          onClick: (event) => {
            event.preventDefault()
            navigate('overview')
          },
        },
        el('img', { src: './icon.svg', alt: '', width: '36', height: '36' }),
        el('span', {}, 'Housebook'),
      ),
      el('p', { class: 'sidebar-caption' }, 'A place for everything you know.'),
      el(
        'nav',
        { 'aria-label': 'Main navigation' },
        nav.map(([page, icon, label]) =>
          el(
            'button',
            {
              type: 'button',
              'data-page': page,
              onClick: () => navigate(page),
            },
            el('span', { 'aria-hidden': 'true' }, icon),
            label,
          )
        ),
      ),
      el(
        'div',
        { class: 'sidebar-bottom' },
        el(
          'span',
          { class: 'privacy' },
          demo ? '◇ Shared demo' : '◇ Private housebook',
        ),
        el(
          'small',
          {},
          demo
            ? [
              'Sample records. ',
              el(
                'a',
                { href: 'https://yaks.app/install?name=housebook' },
                'Get your own Housebook',
              ),
            ]
            : 'Your home. Your records.',
        ),
        el(
          'a',
          { href: 'https://yaks.app', target: '_blank', rel: 'noopener' },
          'Made with yaks.app ↗',
        ),
      ),
    ),
    el(
      'div',
      { class: 'workspace' },
      el(
        'header',
        { class: 'topbar' },
        el(
          'label',
          { class: 'search' },
          el('span', { 'aria-hidden': 'true' }, '⌕'),
          search,
        ),
        el('span', { class: 'user' }, who.name || 'Housebook'),
      ),
      content,
    ),
  )
}
let start = async () => {
  // The house's records are asked for while me() says who is looking, so the
  // first rows and the answer arrive together; a visitor who may not read has
  // the subscription ended unheard.
  let live = subscribe(everything, (rows) => {
    data = byKind(rows)
    if (content) draw()
  })
  stop.push(live)
  who = await me()
  if (!who.reads) {
    stop.forEach((fn) => fn())
    document.getElementById('app').replaceChildren(
      el(
        'p',
        { class: 'loading' },
        'This housebook is private. ',
        el('a', { href: who.signIn || '/' }, 'Sign in'),
      ),
    )
    return
  }
  desk = drafts({ by: who.person, report: fail })
  await live.ready
  edit = editor({
    dialog: document.getElementById('editor'),
    desk,
    items,
    save,
    fail,
  })
  let [page, detail] = location.hash.slice(1).split('/')
  if (page) {
    state.page = page
    state.category = page === 'manual' && detail
      ? decodeURIComponent(detail)
      : ''
    state.item = page === 'item' ? detail : null
  }
  shell()
  draw()
  addEventListener('beforeunload', () => {
    stop.forEach((fn) => fn())
    desk.close()
  })
  addEventListener('hashchange', () => {
    let [page, detail] = location.hash.slice(1).split('/')
    state.page = page || 'overview'
    state.item = page === 'item' ? detail : null
    state.category = page === 'manual' && detail
      ? decodeURIComponent(detail)
      : ''
    draw()
  })
}
start().catch((error) => {
  document.getElementById('app').replaceChildren(
    el(
      'div',
      { class: 'loading' },
      el('h1', {}, 'Your housebook could not open'),
      el('p', {}, error.message),
      button('Try again', () => location.reload()),
    ),
  )
  fail(error)
})
