import { imageUrl } from './media.js'
import { date, id, safeUrl, text, title } from './model.js'

let prose = (value) => `<p class="notes">${text(value)}</p>`
let facts = (values) =>
  `<dl>${
    values.filter(([, value]) => value != null && value !== '').map((
      [label, value],
    ) => `<dt>${text(label)}</dt><dd>${text(value)}</dd>`).join('')
  }</dl>`
export let handover = (data, selected, includeLogs, files = new Map()) => {
  let profile = data.house_profile[0]
  let items = data.house_item.filter((row) => selected.has(id(row)))
  let documents = data.house_file.filter((row) =>
    selected.has(row.house_file.item)
  )
  let circuits = items.some((row) => row.house_item.category === 'Electrical')
    ? data.house_circuit
    : []
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${
    text(title(profile))
  } · House manual</title><style>body{font:16px/1.6 system-ui;color:#20372f;max-width:850px;margin:50px auto;padding:0 24px}h1,h2{font-family:Georgia,serif}h1{font-size:42px}h2{border-top:1px solid #b7c6bd;padding-top:24px}dl{display:grid;grid-template-columns:180px 1fr;gap:5px}dt{color:#647368}dd{margin:0}.notes{white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}a{color:#285e4a}article{break-inside:avoid}small{color:#647368}img{display:block;max-width:100%;max-height:450px;object-fit:contain;margin:12px 0}@media print{body{margin:0}.print{display:none}}</style><body><small>Housebook · Handover manual</small><h1>${
    text(title(profile))
  }</h1>${
    profile?.house_profile?.address ? prose(profile.house_profile.address) : ''
  }${prose(profile?.doc?.body || '')}<p>Prepared ${
    text(date(new Date().toLocaleDateString('en-CA')))
  }. This is a saved copy; it does not update automatically.</p>${
    facts([['Water shutoff', profile?.house_profile?.water], [
      'Gas shutoff',
      profile?.house_profile?.gas,
    ], ['Electrical disconnect', profile?.house_profile?.electric]])
  }${
    items.map((row) =>
      `<article><h2>${text(title(row))}</h2>${
        facts(
          Object.entries(row.house_item).filter(([k]) => k !== 'handover').map((
            [k, v],
          ) => [k, v]),
        )
      }${prose(row.doc?.body || '')}${
        documents.filter((f) => f.house_file.item === id(row)).map((f) => {
          let href = files.get(id(f)) || safeUrl(f.house_file.url)
          return `<p>${
            href && imageUrl(f)
              ? `<a href="${text(href)}"><img src="${text(href)}" alt="${
                text(title(f))
              }"></a>`
              : ''
          }${
            href
              ? `<a href="${text(href)}"${
                files.has(id(f)) ? ` download="${text(title(f))}"` : ''
              }>${text(title(f))}</a>`
              : text(title(f))
          }${f.doc?.body ? `<br><small>${text(f.doc.body)}</small>` : ''}</p>`
        }).join('')
      }${
        includeLogs
          ? data.house_record.filter((r) => r.house_record.item === id(row))
            .sort((a, b) =>
              (b.house_record.date || '').localeCompare(
                a.house_record.date || '',
              )
            ).map((r) =>
              `<h3>${text(date(r.house_record.date))} · ${text(title(r))}</h3>${
                facts([['Type', r.house_record.kind], [
                  'Provider',
                  r.house_record.provider,
                ], [
                  'Cost',
                  r.house_record.cost == null ? '' : '$' + r.house_record.cost,
                ]])
              }${prose(r.doc?.body || '')}`
            ).join('')
          : ''
      }</article>`
    ).join('')
  }${
    circuits.length
      ? `<h2>Electrical circuit directory</h2><table><tr><th>Side</th><th>Slots</th><th>Rating</th><th>Label</th></tr>${
        circuits.map((r) =>
          `<tr><td>${text(r.house_circuit.side)}</td><td>${
            text(r.house_circuit.slots)
          }</td><td>${r.house_circuit.off ? '<s>' : ''}${
            text(r.house_circuit.amps)
          }${r.house_circuit.off ? '</s>' : ''}</td><td>${text(title(r))}${
            r.house_circuit.off ? ' · OFF' : ''
          }</td></tr>`
        ).join('')
      }</table>`
      : ''
  }<p><small>Recorded information may need verification at the equipment. Historical references are preserved as references, not current code advice.</small></p></body></html>`
}
export let download = (content, name, type = 'text/html') => {
  let url = URL.createObjectURL(new Blob([content], { type }))
  let link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export let embedded = async (rows) =>
  new Map(
    await Promise.all(
      rows.filter((r) => r.house_file.blob).map(async (row) => {
        let response = await fetch(`./api/blob/${row.house_file.blob}`)
        if (!response.ok) {
          throw new Error(
            `Could not include ${title(row)}. Try again before sharing.`,
          )
        }
        let blob = await response.blob()
        let encoded = await new Promise((resolve, reject) => {
          let reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        return [id(row), encoded]
      }),
    ),
  )
