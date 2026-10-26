export let categories = [
  'Kitchen & appliances',
  'Heating & cooling',
  'Plumbing & water',
  'Electrical',
  'Paint & finishes',
  'Roof & exterior',
  'Structure & insulation',
  'Doors & windows',
  'Garden & grounds',
  'Safety & security',
  'Insurance & property',
  'Other',
]
export let kinds = {
  house_item: 'item',
  house_record: 'log entry',
  house_care: 'reminder',
  house_contact: 'contact',
  house_file: 'document',
  house_circuit: 'circuit',
  house_profile: 'home details',
}
// Everything the house keeps, asked as one line, so a load is one request and
// the page one subscription rather than one of each per kind.
export let everything = `(${
  Object.keys(kinds).map((kind) => '.' + kind).join('|')
})&?doc&.limit=10000`
export let byKind = (rows) =>
  Object.fromEntries(
    Object.keys(kinds).map((kind) => [kind, rows.filter((row) => row[kind])]),
  )
export let title = (row) => row?.doc?.title || 'Untitled'
export let id = (row) => row?.entity?.eid
export let today = () => new Date().toLocaleDateString('en-CA')
export let date = (value) =>
  value
    ? new Date(value + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    : 'No date set'
export let nextDue = (day, months) => {
  if (!months) return ''
  let d = new Date(day + 'T12:00:00'), n = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  d.setDate(
    Math.min(n, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()),
  )
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}
export let due = (row) => row.house_care.due && row.house_care.due <= today()
export let text = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]),
  )
export let safeUrl = (value) => {
  try {
    let u = new URL(value)
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)
      ? u.href
      : ''
  } catch {
    return ''
  }
}
export let searchRows = (rows, term) =>
  rows.filter((row) =>
    JSON.stringify(row).toLowerCase().includes(term.toLowerCase())
  )
export let itemName = (rows, eid) => title(rows.find((r) => id(r) === eid))
export let fields = {
  house_item: [
    ['title', 'Name', 'text', true],
    ['category', 'Category', 'category'],
    ['location', 'Room or location'],
    ['brand', 'Brand'],
    ['model', 'Model number'],
    ['serial', 'Serial number'],
    ['manufactured', 'Manufactured (as recorded)'],
    ['installed', 'Installed (as recorded)'],
    ['warranty', 'Warranty / expiry'],
    ['body', 'Instructions, specifications & notes', 'textarea'],
    ['handover', 'Include in handover by default', 'checkbox'],
  ],
  house_record: [
    ['title', 'What happened?', 'text', true],
    ['item', 'Related item', 'item'],
    ['date', 'Date', 'date', true],
    ['kind', 'Type', 'recordkind'],
    ['cost', 'Cost (USD)', 'number'],
    ['provider', 'Who did the work?'],
    ['body', 'Work done, parts used & observations', 'textarea'],
  ],
  house_care: [
    ['title', 'What needs doing?', 'text', true],
    ['item', 'Related item', 'item'],
    ['due', 'Due date', 'date', true],
    ['months', 'Repeat every (months; 0 = once)', 'number'],
    ['body', 'Instructions or parts needed', 'textarea'],
  ],
  house_contact: [
    ['title', 'Name or company', 'text', true],
    ['trade', 'Trade or role'],
    ['phone', 'Phone', 'tel'],
    ['email', 'Email', 'email'],
    ['website', 'Website', 'url'],
    ['body', 'Notes', 'textarea'],
  ],
  house_file: [
    ['title', 'Document title', 'text', true],
    ['item', 'Related item', 'item'],
    ['url', 'Document URL — a copy is saved in Housebook', 'url'],
    ['reference', 'Website reference (a webpage, not a document)', 'checkbox'],
    ['body', 'Notes', 'textarea'],
  ],
  house_circuit: [
    ['slots', 'Slot(s)', 'text', true],
    ['title', 'What it serves', 'text', true],
    ['amps', 'Rating (as recorded)'],
    ['side', 'Side', 'side'],
    ['off', 'Marked OFF in the manual', 'checkbox'],
    ['body', 'Notes', 'textarea'],
  ],
  house_profile: [
    ['title', 'House name', 'text', true],
    ['address', 'Address'],
    ['water', 'Main water shutoff location'],
    ['gas', 'Gas shutoff location'],
    ['electric', 'Main electrical disconnect location'],
    ['body', 'Welcome & household notes', 'textarea'],
  ],
}
