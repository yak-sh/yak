import { fileMark, fileUrl, imageUrl, preview } from './media.js'
import { transfer } from './handover-view.js'
import { button, el, empty, tag } from './dom.js'
import { categories, date, due, id, itemName, safeUrl, title } from './model.js'

export let view = (
  {
    data,
    edit,
    open,
    navigate,
    complete,
    remove,
    handover,
    select,
    selected,
    who,
  },
) => {
  let items = () => data.house_item
  let add = (kind, label, defaults) =>
    who.writes
      ? button(label, () => edit(kind, null, defaults), 'primary')
      : null
  let heading = (name, body, action) =>
    el(
      'div',
      { class: 'page-heading' },
      el('div', {}, el('h1', {}, name), el('p', {}, body)),
      action,
    )
  let card = (row) =>
    el(
      'button',
      {
        class: 'item-card',
        type: 'button',
        onClick: () => open(id(row)),
      },
      preview(
        data.house_file.find((file) =>
          file.house_file.item === id(row) && imageUrl(file)
        ),
        'item-photo',
        () =>
          el('div', { class: 'item-symbol' }, symbol(row.house_item.category)),
      ),
      el(
        'div',
        {},
        tag(row.house_item.category),
        el('h3', {}, title(row)),
        el(
          'p',
          {},
          [row.house_item.brand, row.house_item.model].filter(Boolean).join(
            ' · ',
          ) || 'Details ready to add',
        ),
        el('small', {}, row.house_item.location || 'Location not recorded'),
      ),
      el('span', { class: 'arrow' }, '↗'),
    )
  let rowActions = (kind, row) =>
    who.writes
      ? el(
        'div',
        { class: 'row-actions' },
        button('Edit', () => edit(kind, row)),
        button('Remove', () => remove(row), 'quiet'),
      )
      : null
  let doc = (row) => {
    let f = row.house_file,
      url = fileUrl(row)
    return el(
      'article',
      { class: 'list-row' },
      imageUrl(row)
        ? el(
          'a',
          {
            href: url,
            target: '_blank',
            rel: 'noopener',
            class: 'photo-link',
            'aria-label': `Open ${title(row)}`,
          },
          preview(row, 'document-photo', () =>
            el('span', { class: 'file-icon' }, fileMark(row))),
        )
        : el('span', { class: 'file-icon' }, fileMark(row)),
      el(
        'div',
        { class: 'grow' },
        url
          ? el(
            'a',
            { href: url, target: '_blank', rel: 'noopener' },
            title(row),
          )
          : el('strong', {}, title(row)),
        el(
          'p',
          { class: 'related-item' },
          f.item
            ? el('a', {
              href: '#item/' + f.item,
              onClick: (event) => {
                event.preventDefault()
                open(f.item)
              },
            }, itemName(items(), f.item))
            : 'House reference',
        ),
        row.doc?.body
          ? el('p', { class: 'document-notes' }, row.doc.body)
          : null,
      ),
      rowActions('house_file', row),
    )
  }
  let log = (row) =>
    el(
      'article',
      { class: 'log-row' },
      el('time', {}, date(row.house_record.date)),
      el(
        'div',
        { class: 'grow' },
        tag(row.house_record.kind || 'Note'),
        el('h3', {}, title(row)),
        row.house_record.item
          ? el(
            'p',
            { class: 'muted' },
            itemName(items(), row.house_record.item),
          )
          : null,
        el('p', { class: 'notes' }, row.doc?.body || ''),
        el(
          'small',
          {},
          [
            row.house_record.provider,
            row.house_record.cost != null
              ? `$${row.house_record.cost.toFixed(2)}`
              : '',
          ].filter(Boolean).join(' · '),
        ),
      ),
      rowActions('house_record', row),
    )
  let reminder = (row) =>
    el(
      'article',
      { class: 'list-row' },
      el(
        'div',
        { class: 'date-chip ' + (due(row) ? 'overdue' : '') },
        el('strong', {}, row.house_care.due?.slice(8) || '—'),
        el(
          'span',
          {},
          row.house_care.due
            ? new Date(row.house_care.due + 'T12:00:00').toLocaleDateString(
              undefined,
              { month: 'short' },
            )
            : '',
        ),
      ),
      el(
        'div',
        { class: 'grow' },
        el('h3', {}, title(row)),
        el(
          'p',
          {},
          row.house_care.item
            ? itemName(items(), row.house_care.item)
            : 'Whole house',
        ),
        el(
          'small',
          {},
          `${date(row.house_care.due)}${
            row.house_care.months
              ? ` · Every ${row.house_care.months} months`
              : ' · One time'
          }`,
        ),
        row.doc?.body ? el('p', { class: 'notes' }, row.doc.body) : null,
      ),
      who.writes
        ? el(
          'div',
          { class: 'row-actions' },
          button('Mark done', () => complete(row), 'primary'),
          button('Edit', () => edit('house_care', row)),
          button('Remove', () => remove(row), 'quiet'),
        )
        : null,
    )
  let docs = (rows) =>
    rows.length ? el('div', { class: 'list' }, rows.map(doc)) : empty(
      'Keep the paperwork with the house',
      'Add manuals, receipts, warranties, plans and photos. Upload a file or save a link.',
    )
  let logs = (rows) =>
    rows.length
      ? el(
        'div',
        { class: 'logbook' },
        [...rows].sort((a, b) =>
          (b.house_record.date || '').localeCompare(a.house_record.date || '')
        ).map(log),
      )
      : empty(
        'The next chapter starts here',
        'Record a repair, a service visit, a new appliance or a small detail worth remembering.',
      )
  let reminders = (rows) =>
    rows.length
      ? el(
        'div',
        { class: 'list' },
        [...rows].sort((a, b) =>
          (a.house_care.due || '').localeCompare(b.house_care.due || '')
        ).map(reminder),
      )
      : empty(
        'A little care, on time',
        'Add your own maintenance dates. Completing a reminder writes to the logbook and schedules its next occurrence.',
      )
  let overview = () => {
    let profile = data.house_profile[0], p = profile?.house_profile || {}
    return el(
      'div',
      {},
      el(
        'section',
        { class: 'hero' },
        el(
          'div',
          {},
          el('span', { class: 'eyebrow' }, 'A home, well remembered'),
          el(
            'h1',
            {},
            title(profile) === 'Untitled'
              ? 'Your house, in one place'
              : title(profile),
          ),
          el(
            'p',
            {},
            'The details that make a house yours. The knowledge that helps you care for it.',
          ),
          el(
            'div',
            { class: 'hero-actions' },
            add('house_item', '+ Add an item'),
            button('Write in the logbook', () => navigate('logbook')),
          ),
        ),
        houseDrawing(),
      ),
      el(
        'div',
        { class: 'stats' },
        [
          ['Items in your manual', items().length, 'manual'],
          ['Documents & links', data.house_file.length, 'documents'],
          ['Due for attention', data.house_care.filter(due).length, 'care'],
          ['Logbook entries', data.house_record.length, 'logbook'],
        ].map(([label, n, page]) =>
          el(
            'button',
            { type: 'button', onClick: () => navigate(page) },
            el('strong', {}, String(n)),
            el('span', {}, label),
          )
        ),
      ),
      el(
        'div',
        { class: 'section-head' },
        el('h2', {}, 'Explore your home'),
        button(
          'See the full manual →',
          () => navigate('manual'),
          'text-button',
        ),
      ),
      el(
        'div',
        { class: 'category-grid' },
        categories.map((category) =>
          el(
            'button',
            {
              type: 'button',
              class: 'category',
              onClick: () => navigate('manual', category),
            },
            el('span', { class: 'category-icon' }, symbol(category)),
            el('strong', {}, category),
            el(
              'small',
              {},
              `${
                items().filter((r) => r.house_item.category === category).length
              } items`,
            ),
          )
        ),
      ),
      el(
        'div',
        { class: 'two-columns' },
        el(
          'section',
          {},
          el(
            'div',
            { class: 'section-head' },
            el('h2', {}, 'Next on the list'),
            button('All care →', () => navigate('care'), 'text-button'),
          ),
          reminders(
            [...data.house_care].sort((a, b) =>
              (a.house_care.due || '').localeCompare(b.house_care.due || '')
            ).slice(0, 3),
          ),
        ),
        el(
          'section',
          {},
          el(
            'div',
            { class: 'section-head' },
            el('h2', {}, 'Know where to look'),
            who.writes
              ? button(
                'Edit',
                () => edit('house_profile', profile),
                'text-button',
              )
              : null,
          ),
          el(
            'div',
            { class: 'shutoffs' },
            [['Water shutoff', p.water], ['Gas shutoff', p.gas], [
              'Electrical disconnect',
              p.electric,
            ]].map(([label, value]) =>
              el(
                'div',
                {},
                el('strong', {}, label),
                el('p', {}, value || 'Location not recorded'),
              )
            ),
          ),
        ),
      ),
      profile?.doc?.body
        ? el(
          'section',
          { class: 'home-note' },
          el('h2', {}, 'About this home'),
          el('p', { class: 'notes' }, profile.doc.body),
        )
        : null,
    )
  }
  let manual = (rows, category) =>
    el(
      'div',
      {},
      heading(
        'The house manual',
        'Every system, fixture and finish — with its details close at hand.',
        add('house_item', '+ Add an item', {
          category: category || categories[0],
        }),
      ),
      el(
        'div',
        { class: 'filters' },
        button(
          'Everything',
          () => navigate('manual'),
          !category ? 'active' : '',
        ),
        categories.map((c) =>
          button(c, () => navigate('manual', c), c === category ? 'active' : '')
        ),
      ),
      rows.length ? el('div', { class: 'items-grid' }, rows.map(card)) : empty(
        'Room for the details',
        'Add the model number, paint color, warranty or instructions you will be glad to find later.',
        add('house_item', 'Add the first item', {
          category: category || categories[0],
        }),
      ),
    )
  let detail = (row) => {
    let p = row.house_item,
      related = (kind) => data[kind].filter((r) => r[kind].item === id(row))
    let section = (name, kind, render) =>
      el(
        'section',
        {},
        el(
          'div',
          { class: 'section-head' },
          el('h2', {}, name),
          add(kind, '+ Add', { item: id(row) }),
        ),
        render(related(kind)),
      )
    return el(
      'div',
      {},
      button('← House manual', () => navigate('manual'), 'text-button'),
      heading(
        title(row),
        [p.category, p.location].filter(Boolean).join(' / '),
        who.writes
          ? button('Edit details', () => edit('house_item', row), 'primary')
          : null,
      ),
      el(
        'div',
        { class: 'detail-grid' },
        el(
          'section',
          { class: 'details' },
          el('h2', {}, 'At a glance'),
          el(
            'dl',
            {},
            [
              ['Brand', p.brand],
              ['Model', p.model],
              ['Serial number', p.serial],
              ['Manufactured', p.manufactured],
              ['Installed', p.installed],
              ['Warranty', p.warranty],
            ].map((
              [label, value],
            ) => [el('dt', {}, label), el('dd', {}, value || 'Not recorded')])
              .flat(),
          ),
        ),
        el(
          'section',
          { class: 'details' },
          el('h2', {}, 'Good to know'),
          el(
            'p',
            { class: 'notes' },
            row.doc?.body ||
              'Add specifications, instructions and the little things only you know.',
          ),
        ),
      ),
      section('Documents & photos', 'house_file', docs),
      section('Maintenance', 'house_care', reminders),
      section('History', 'house_record', logs),
      who.writes
        ? el(
          'div',
          { class: 'detail-footer' },
          button('Remove this item', () => remove(row), 'quiet'),
          el('small', {}, 'Linked documents and history are kept.'),
        )
        : null,
    )
  }
  let panel = (rows) =>
    el(
      'div',
      {},
      heading(
        'Electrical directory',
        'Labels transcribed from your panel notes. Verify at the panel before use.',
        add('house_circuit', '+ Add a circuit'),
      ),
      el(
        'div',
        { class: 'panel-columns' },
        ['Left', 'Right'].map((side) =>
          el(
            'section',
            { class: 'breaker-panel' },
            el('h2', {}, side + ' slots'),
            rows.filter((r) => r.house_circuit.side === side).sort((a, b) =>
              parseInt(a.house_circuit.slots) - parseInt(b.house_circuit.slots)
            ).map((row) =>
              el(
                'article',
                { class: 'breaker ' + (row.house_circuit.off ? 'off' : '') },
                el('strong', { class: 'slot' }, row.house_circuit.slots),
                el(
                  row.house_circuit.off ? 's' : 'span',
                  { class: 'amps' },
                  row.house_circuit.amps,
                ),
                el(
                  'span',
                  { class: 'grow' },
                  title(row),
                  row.house_circuit.off ? tag('OFF') : null,
                ),
                who.writes
                  ? button('Edit', () => edit('house_circuit', row), 'quiet')
                  : null,
              )
            ),
          )
        ),
      ),
    )
  let contacts = (rows) =>
    el(
      'div',
      {},
      heading(
        'People who know the house',
        'The right number when you need a hand.',
        add('house_contact', '+ Add a contact'),
      ),
      rows.length
        ? el(
          'div',
          { class: 'items-grid' },
          rows.map((row) =>
            el(
              'article',
              { class: 'contact' },
              tag(row.house_contact.trade || 'Contact'),
              el('h2', {}, title(row)),
              row.house_contact.phone
                ? el(
                  'a',
                  { href: 'tel:' + row.house_contact.phone },
                  row.house_contact.phone,
                )
                : null,
              row.house_contact.email
                ? el(
                  'a',
                  { href: 'mailto:' + row.house_contact.email },
                  row.house_contact.email,
                )
                : null,
              safeUrl(row.house_contact.website)
                ? el('a', {
                  href: safeUrl(row.house_contact.website),
                  target: '_blank',
                  rel: 'noopener',
                }, 'Visit website ↗')
                : null,
              el('p', { class: 'notes' }, row.doc?.body || ''),
              rowActions('house_contact', row),
            )
          ),
        )
        : empty(
          'Your trusted people',
          'Keep the plumber, electrician, HVAC technician, insurer and other contacts here.',
        ),
    )
  return {
    overview,
    manual,
    detail,
    panel,
    contacts,
    transfer: () =>
      transfer({ heading, items, select, selected, navigate, handover }),
    docs,
    logs,
    reminders,
    heading,
    add,
  }
}
let symbol = (name) =>
  ({
    'Kitchen & appliances': '▦',
    'Heating & cooling': '≈',
    'Plumbing & water': '◉',
    'Electrical': 'ϟ',
    'Paint & finishes': '◒',
    'Roof & exterior': '⌂',
    'Structure & insulation': '▤',
    'Doors & windows': '⊞',
    'Garden & grounds': '❧',
    'Safety & security': '◇',
    'Insurance & property': '▧',
    'Other': '⋯',
  })[name] || '⌂'
let houseDrawing = () => {
  let drawing = el('div', { class: 'house-drawing', 'aria-hidden': 'true' })
  drawing.innerHTML =
    '<svg viewBox="0 0 320 230" fill="none"><g stroke="currentColor" stroke-width="1.5"><path d="M35 115 155 33l124 82M56 100v99h202v-99M37 202h245M70 209h198M155 34v-9l-16-8M224 77V42h20v48M89 197v-65h37v65M159 122h68v42h-68zM193 123v40M160 143h66M103 90h27V66M153 57l87 58M67 107l85-60"/><circle cx="116" cy="163" r="2"/><path d="M281 195c-25-22-16-51-2-60 18 17 21 43 2 60Zm0-3v20M26 198c-13-12-9-27-1-32 9 9 11 23 1 32Zm0-2v15"/></g><g stroke="currentColor" opacity=".25" stroke-dasharray="3 5"><path d="M19 216h283M19 15v200M298 15v200M18 16h282"/></g></svg>'
  return drawing
}
