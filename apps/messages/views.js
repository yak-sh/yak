// The screens, as HTML from the model. A button names what it does with
// `data-act` and the thing it does it to with `data-id`; app.js answers them.
import { html, icon } from './html.js'
import {
  conversations,
  findPeople,
  initials,
  plural,
  reach,
  recipients,
  segments,
  shown,
  signed,
  when,
} from './model.js'

let TABS = [
  ['inbox', 'Inbox'],
  ['send', 'Send'],
  ['lists', 'Lists'],
]

/** The header and tab bar around a screen. */
export let frame = (m, tab, waiting) => {
  let tabs = TABS.map(([k, label]) =>
    html`
      <a href="${k}" class="${tab == k ? 'on' : ''}"
        ${tab == k ? html`aria-current="page"` : ''}>${icon(
          k,
        )}<span>${label}</span>${k == 'inbox' && waiting
          ? html`<b class="count">${waiting}</b>`
          : ''}</a>
    `
  )
  return {
    top: html`<a class="brand" href="inbox"><b>${
      m.church?.name || 'Church'
    }</b><small>Messages</small></a><nav class="tabs">${tabs}</nav>`,
    bottom: html`${tabs}`,
  }
}

let avatar = (name) =>
  html`<span class="avatar" aria-hidden="true">${initials(name)}</span>`
let back = (href, label) =>
  html`<a class="back" href="${href}">${icon('back')}${label}</a>`
let readOnly = html`
  <p
    class="note">You can read these messages. Only the church office can send them.</p>
`

// ---------- inbox ----------

export let inbox = (m, ui) => {
  let all = conversations(m)
  let open = all.filter((c) => c.waiting), done = all.filter((c) => !c.waiting)
  let row = (c) =>
    html`<a class="row ${c.waiting ? 'new' : ''}" href="inbox/${c.number}">
      ${avatar(c.name)}
      <span class="grow"><b>${c.name}</b><span class="snip">${
      c.last.out ? 'You: ' : ''
    }${c.last.body}</span></span>
      <span class="when">${when(c.last.at, ui.now)}</span>
    </a>`
  return html`<h1>Inbox</h1>
    ${
    open.length ? html`<div class="rows">${open.map(row)}</div>` : html`
      <p
        class="empty">Nothing is waiting. When someone texts the church, their message shows up here.</p>
    `
  }
    ${
    done.length
      ? html`
        <h2>Answered</h2>
        <div class="rows">${done.slice(0, 50).map(row)}</div>
      `
      : ''
  }`
}

let state = (t) =>
  t.state == 'delivered'
    ? 'Delivered'
    : t.state == 'bounced'
    ? html`<span class="bad">Not sent: ${t.reason}</span>`
    : 'Sending…'

export let thread = (m, number, who, ui) => {
  let c = conversations(m).find((c) => c.number == number)
  if (!c) {
    return html`${back('inbox', 'Inbox')}<p class="empty">No messages with ${
      shown(number)
    }.</p>`
  }
  let lists = c.person
    ? [...m.groups.values()].filter((g) =>
      g.members.some((x) => x.person.eid == c.person.eid)
    )
      .map((g) => g.name)
    : []
  let bubbles = c.texts.map((t) => {
    let b = t.broadcast && m.broadcasts.get(t.broadcast)
    let list = b && m.groups.get(b.group)?.name
    return html`
      <div class="bubble ${t.out ? 'out' : 'in'}">
        <p>${t.body}</p>
        <small>${when(t.at, ui.now)}${t.out
          ? html`
            · ${list
              ? `To the ${list} list`
              : t.by || 'Automatic answer'} · ${state(t)}
          `
          : ''}</small>
      </div>
    `
  })
  let answer = c.stopped
    ? html`
      <p
        class="note">${c.name} texted STOP ${when(
          c.stopped,
          ui.now,
        )}, so the church can't text them. If they text START, they can get texts again.</p>
    `
    : who.writes
    ? html`
      <form class="reply" data-form="reply" data-id="${c.number}">
        <label for="reply-text" class="sr">Reply to ${c.name}</label>
        <textarea id="reply-text" name="body" rows="3" placeholder="Write a reply…"
          required></textarea>
        <div class="actions">
                <button class="btn primary" type="submit">${icon(
                  'send',
                )}Send reply</button>
                ${c.waiting
                  ? html`
                    <button class="btn" type="button" data-act="done"
                      data-id="${c.number}">${icon(
                        'check',
                      )}Mark as answered</button>
                  `
                  : ''}
              </div>
      </form>
    `
    : readOnly
  return html`${back('inbox', 'Inbox')}
    <header class="who">${
    avatar(c.name)
  }<div><h1>${c.name}</h1><p class="muted">${shown(c.number)}${
    lists.length ? ` · ${lists.join(', ')}` : ''
  }${c.person ? '' : ' · not in the directory'}</p></div></header>
    <div class="bubbles">${bubbles}</div>
    ${answer}`
}

// ---------- send ----------

export let send = (m, who, ui) => {
  let groups = [...m.groups.values()]
  let pick = ui.group && m.groups.has(ui.group) ? ui.group : groups[0]?.eid
  let past = [...m.broadcasts.values()].sort((a, b) => b.at.localeCompare(a.at))
  let compose = !who.writes
    ? readOnly
    : !groups.length
    ? html`<p class="empty">Make a list first, on <a href="lists">Lists</a>.</p>`
    : html`<form class="compose" data-form="broadcast">
      <fieldset><legend>Send to</legend>
        ${
      groups.map((g) => {
        let n = recipients(m, g.eid).to.length
        return html`
          <label
            class="choice"><input type="radio" name="group" value="${g
              .eid}" ${g.eid == pick
              ? 'checked'
              : ''} data-act="pick"><span><b>${g.name}</b><small>${plural(
                n,
                'person',
                'people',
              )}</small></span></label>
        `
      })
    }
      </fieldset>
      <label for="broadcast-text" class="label">Message</label>
      <textarea id="broadcast-text" name="body" rows="6" placeholder="Write the message…" required></textarea>
      <p class="hint" id="broadcast-count">${count(m, ui.body)}</p>
      ${
      ui.confirm ? confirm(m, ui.confirm, ui.body) : html`
        <button class="btn primary big"
          type="submit">${icon('send')}Review and send</button>
      `
    }
    </form>`
  return html`<h1>Send a message</h1>
    ${compose}
    <h2>Sent</h2>
    ${
    past.length
      ? html`<div class="rows">${past.map((b) => sentRow(m, b, ui))}</div>`
      : html`
        <p
          class="empty">Messages the church sends are listed here, with who got them.</p>
      `
  }`
}

/** The line under the message box: what it will read as and how long it is. */
export let count = (m, body) => {
  if (!String(body ?? '').trim()) {
    return `Each text begins with “${
      m.church?.name || 'the church'
    }:” so people know who it's from.`
  }
  let s = segments(signed(m.church?.name, body))
  return `${s.chars} characters · sent as ${plural(s.texts, 'text')}${
    s.plain ? '' : ' (emoji and curly quotes make texts shorter)'
  }`
}

let confirm = (m, group, body) => {
  let g = m.groups.get(group)
  let { to, left } = recipients(m, group)
  let reasons = Object.entries(Object.groupBy(left, (l) => l.why))
    .map(([why, ls]) => `${ls.length} ${why}`)
  return html`<div class="confirm" role="alertdialog" aria-labelledby="confirm-title">
    <h3 id="confirm-title">Send to ${
    plural(to.length, 'person', 'people')
  } on the ${g?.name} list?</h3>
    <blockquote>${signed(m.church?.name, body)}</blockquote>
    ${
    left.length
      ? html`<p class="muted">${
        plural(left.length, 'person', 'people')
      } won't get it: ${reasons.join(', ')}.</p>`
      : ''
  }
    <div class="actions">
      <button class="btn primary big" type="button" data-act="send" ${
    to.length ? '' : 'disabled'
  }>Send now</button>
      <button class="btn big" type="button" data-act="cancel">Not yet</button>
    </div>
  </div>`
}

let summary = (r) =>
  [
    r.delivered.length && `${r.delivered.length} delivered`,
    r.bounced.length && `${r.bounced.length} not sent`,
    r.sending.length && `${r.sending.length} sending`,
  ].filter(Boolean).join(' · ') || 'Nobody'

let sentRow = (m, b, ui) =>
  html`
    <a class="row"
      href="sent/${b
        .eid}"><span class="grow"><b>${m.groups.get(b.group)?.name ||
        'A list'} · ${when(b.at, ui.now)}</b><span class="snip">${b
        .body}</span><span class="muted small">${summary(
          reach(m, b.eid),
        )}</span></span>${icon('next')}</a>
  `

export let sent = (m, eid, ui) => {
  let b = m.broadcasts.get(eid)
  if (!b) {
    return html`${
      back('send', 'Send')
    }<p class="empty">That message is not here.</p>`
  }
  let r = reach(m, eid)
  let person = (x, extra = '') =>
    html`<li>${
      x.person
        ? html`<a href="inbox/${x.text.number}">${x.person.name}</a>`
        : shown(x.text.number)
    }${extra}</li>`
  return html`${back('send', 'Send')}
    <h1>To the ${m.groups.get(b.group)?.name || ''} list</h1>
    <p class="muted">${when(b.at, ui.now)}${
    b.by ? ` · sent by ${b.by}` : ''
  }</p>
    <blockquote>${b.body}</blockquote>
    <p class="tally">${summary(r)}</p>
    ${
    r.bounced.length
      ? html`
        <h2>Not sent</h2>
        <ul class="people">${r.bounced.map((x) =>
          person(
            x,
            html`
              <span class="bad">${x.text.reason}</span>
            `,
          )
        )}</ul>
      `
      : ''
  }
    ${
    r.sending.length
      ? html`
        <h2>Sending</h2>
        <ul class="people">${r.sending.map((x) => person(x))}</ul>
      `
      : ''
  }
    ${
    r.delivered.length
      ? html`
        <h2>Delivered</h2>
        <ul class="people">${r.delivered.map((x) => person(x))}</ul>
      `
      : ''
  }`
}

// ---------- lists ----------

export let lists = (m, who) => {
  let groups = [...m.groups.values()]
  return html`<h1>Lists</h1>
    <div class="rows">${
    groups.map((g) =>
      html`
        <a class="row"
          href="lists/${g.eid}"><span class="grow"><b>${g
            .name}</b><span class="muted small">${plural(
              g.members.length,
              'person',
              'people',
            )}</span></span>${icon('next')}</a>
      `
    )
  }
    <a class="row" href="stopped"><span class="grow"><b>Opted out</b><span class="muted small">${
    plural(m.stopped.size, 'number')
  } texted STOP</span></span>${icon('next')}</a></div>
    ${
    who.writes
      ? html`
        <form class="inline" data-form="group">
          <label for="group-name" class="label">New list</label>
          <div
            class="field"><input id="group-name" name="list" placeholder="Like “Youth parents”" required autocomplete="off"><button class="btn" type="submit">${icon(
              'plus',
            )}Make list</button></div>
        </form>
      `
      : ''
  }`
}

export let list = (m, eid, who, ui) => {
  let g = m.groups.get(eid)
  if (!g) {
    return html`${
      back('lists', 'Lists')
    }<p class="empty">That list is not here.</p>`
  }
  let members = g.members.map(({ person: p }) => {
    let no = recipients(m, eid).left.find((l) => l.person.eid == p.eid)?.why
    return html`
      <li
        class="person"><span class="grow"><b>${p
          .name}</b><span class="muted small">${shown(p.mobile) ||
          'No mobile number'}${no
          ? html`
            · <span class="bad">${no}</span>
          `
          : ''}</span></span>${who.writes
          ? html`
            <button class="iconbtn" type="button" data-act="leave" data-id="${p
              .eid}"
              aria-label="Take ${p.name} off the list">${icon('x')}</button>
          `
          : ''}</li>
    `
  })
  let on = new Set(g.members.map((x) => x.person.eid))
  let found = ui.words != null ? findPeople(m, ui.words, on).slice(0, 30) : []
  let add = !who.writes ? '' : html`
    <section class="add">
      <h2>Add people</h2>
      <p
        class="muted small">Only add people who asked to get texts from ${m
          .church?.name ||
          'the church'}. Adding them records that they agreed.</p>
      <label for="find" class="sr">Find someone in the directory</label>
      <input id="find" type="search" data-act="find"
        placeholder="Name or phone number" value="${ui.words ??
          ''}" autocomplete="off">
      <ul class="people">${found.map((p) =>
        html`
          <li
            class="person"><span class="grow"><b>${p
              .name}</b><span class="muted small">${shown(
                p.mobile,
              )}${m.stopped.has(p.mobile)
              ? html`
                · <span class="bad">texted STOP</span>
              `
              : ''}</span></span>${m.stopped.has(p.mobile) ? '' : html`
              <button class="btn" type="button" data-act="join"
                data-id="${p.eid}">${icon('plus')}Add</button>
            `}</li>
        `
      )}</ul>
    </section>
  `
  return html`${back('lists', 'Lists')}
    <h1>${g.name}</h1>
    <p class="muted">${plural(g.members.length, 'person', 'people')}</p>
    ${add}
    <ul class="people">${members}</ul>
    ${
    who.writes
      ? html`<p><button class="link danger" type="button" data-act="drop" data-id="${eid}">Delete this list</button></p>`
      : ''
  }`
}

export let stoppedList = (m, ui) => {
  let rows = [...m.stopped].sort((a, b) => b[1].localeCompare(a[1]))
  return html`${back('lists', 'Lists')}
    <h1>Opted out</h1>
    <p class="muted">These numbers texted STOP. The church can't text them until they text START.</p>
    ${
    rows.length
      ? html`<ul class="people">${
        rows.map(([n, at]) =>
          html`
            <li
              class="person"><span class="grow"><b>${m.byNumber.get(n)?.name ||
                shown(n)}</b><span class="muted small">${shown(n)} · ${when(
                  at,
                  ui.now,
                )}</span></span></li>
          `
        )
      }</ul>`
      : html`<p class="empty">Nobody has opted out.</p>`
  }`
}

/** The screen a path names, and the tab it sits under. */
export let screen = (m, path, who, ui) => {
  let [head, id] = path.split('/')
  if (head == 'send') return { tab: 'send', body: send(m, who, ui) }
  if (head == 'sent') return { tab: 'send', body: sent(m, id, ui) }
  if (head == 'lists' && id) return { tab: 'lists', body: list(m, id, who, ui) }
  if (head == 'lists') return { tab: 'lists', body: lists(m, who) }
  if (head == 'stopped') return { tab: 'lists', body: stoppedList(m, ui) }
  if (head == 'inbox' && id) {
    return { tab: 'inbox', body: thread(m, decodeURIComponent(id), who, ui) }
  }
  return { tab: 'inbox', body: inbox(m, ui) }
}
