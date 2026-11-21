// The corner of an app's pages where a member who may write the app reaches
// the space's Operator (page-script.ts, apps.ts `editOf`): those its Operator
// talks with.
//
// The note: pressed with text selected or not, it opens a note to the Operator quoting
// the selection, and Send puts their words in their own conversation with it,
// beside the page, its title, the selection, the section it is under and the
// release, through the store client's `operatorSend` (app-operator.ts
// `send`). What they type is kept in the tab until it is sent.
//
// The pencil: Pressed, it loads edit mode (edit-mode.ts, at the app's
// `./api/_edit.js`) and the app's store client, and the panel to its left
// counts the person's changes and saves them (`./api/save`, save.ts). Edit
// mode stays on across a reload of the tab until Done.
//
// It is drawn as the badge is (badge.js): a closed shadow root on an element
// of its own beside <body>, which the page's styles cannot reach and an app
// redrawing its body leaves standing. Where the badge shows in the same
// corner, the pencil rides above it. Its tag says where the Operator's chat
// for this app is (`data-yak-edit`), and where the app's own `api/` is when it
// is not under the mount (`data-yak-api`): the home app's at yaks.app, whose
// `/api/` is the platform's.
;(() => {
  let CSS = `
:host {
  all: initial !important;
  position: fixed !important;
  z-index: 2147483647 !important;
  right: calc(8px + env(safe-area-inset-right, 0px)) !important;
  bottom: calc(var(--rise, 0px) + 8px + env(safe-area-inset-bottom, 0px)) !important;
  display: flex !important;
  align-items: flex-end !important;
  gap: 6px !important;
  max-width: calc(100vw - 16px) !important;
  font: 500 13px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important;
}
@media print {
  :host { display: none !important }
}
.panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 10px;
  max-width: min(360px, calc(100vw - 62px));
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #e3d3bf;
  border-radius: 12px;
  background: #fffbf5;
  color: #523828;
  box-shadow: 0 2px 8px rgb(82 56 40 / 0.2);
}
.panel:empty { display: none }
.panel p { margin: 0; flex: 1 1 100% }
.panel a { color: #4c773e; font-weight: 600 }
button {
  font: inherit;
  color: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.panel button {
  padding: 5px 10px;
  border: 1px solid #e3d3bf;
  border-radius: 999px;
  background: #fff;
}
.panel button[hidden] { display: none }
.pencil {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid #e3d3bf;
  border-radius: 50%;
  background: #fffbf5;
  box-shadow: 0 1px 3px rgb(82 56 40 / 0.22);
}
.pencil[aria-pressed=true] { background: #4c773e; color: #fff; border-color: #4c773e }
.pencil:disabled { opacity: 0.6; cursor: progress }
button:focus-visible, a:focus-visible { outline: 2px solid #4c773e; outline-offset: 2px }
svg { width: 18px; height: 18px }
.sheet[hidden] { display: none }
.sheet {
  display: grid;
  gap: 8px;
  width: min(340px, calc(100vw - 62px));
  box-sizing: border-box;
  padding: 10px;
  border: 1px solid #e3d3bf;
  border-radius: 12px;
  background: #fffbf5;
  color: #523828;
  box-shadow: 0 2px 8px rgb(82 56 40 / 0.2);
}
.sheet blockquote {
  margin: 0;
  padding-left: 8px;
  border-left: 3px solid #e3d3bf;
  max-height: 6em;
  overflow: auto;
  white-space: pre-wrap;
}
.sheet blockquote:empty { display: none }
.sheet textarea {
  font: inherit;
  min-height: 5em;
  padding: 6px 8px;
  border: 1px solid #e3d3bf;
  border-radius: 8px;
  background: #fff;
  color: inherit;
  resize: vertical;
}
.sheet .row { display: flex; gap: 8px; justify-content: flex-end; align-items: center }
.sheet .row p { margin: 0; flex: 1 }
.sheet button {
  padding: 5px 12px;
  border: 1px solid #e3d3bf;
  border-radius: 999px;
  background: #fff;
}
.sheet button[type=submit] { background: #4c773e; border-color: #4c773e; color: #fff }
.sheet a { color: #4c773e; font-weight: 600 }
.stack { display: flex; flex-direction: column; align-items: flex-end; gap: 6px }
@media (prefers-color-scheme: dark) {
  .sheet, .sheet textarea, .sheet button:not([type=submit]) {
    border-color: #4d3d34;
    background: #2b231f;
    color: #f1e6d8;
  }
  .sheet a { color: #a7c080 }
  .panel, .pencil, .panel button {
    border-color: #4d3d34;
    background: #2b231f;
    color: #f1e6d8;
  }
  .panel a { color: #a7c080 }
}`
  let PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>' +
    '<path d="m15 5 4 4"/></svg>'

  let NOTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'

  let script = document.currentScript
  let at = script?.dataset.yakAt || '/'
  let api = script?.dataset.yakApi || at
  let version = script?.dataset.yakVersion
  let ask = script?.dataset.yakEdit || 'https://yaks.app/'
  let KEPT = 'yaks:editing:' + at
  let host = document.createElement('yaks-edit')
  let root = host.attachShadow({ mode: 'closed' })
  if ('adoptedStyleSheets' in root) {
    let sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    root.adoptedStyleSheets = [sheet]
  } else {
    let style = document.createElement('style')
    style.textContent = CSS
    root.append(style)
  }
  let panel = document.createElement('div')
  panel.className = 'panel'
  panel.setAttribute('role', 'group')
  panel.setAttribute('aria-label', 'Edit mode')
  let pencil = document.createElement('button')
  pencil.type = 'button'
  pencil.className = 'pencil'
  pencil.innerHTML = PENCIL
  pencil.title = "Edit this page's words"
  pencil.setAttribute('aria-label', "Edit this page's words")
  pencil.setAttribute('aria-pressed', 'false')
  let note = document.createElement('button')
  note.type = 'button'
  note.className = 'pencil note'
  note.innerHTML = NOTE
  note.title = 'Send a note to the Operator'
  note.setAttribute('aria-label', 'Send a note to the Operator')
  note.setAttribute('aria-expanded', 'false')
  let sheet = noteSheet()
  let buttons = document.createElement('div')
  buttons.className = 'stack'
  buttons.append(note, pencil)
  root.append(sheet.form, panel, buttons)

  // The note: the selection the reader pressed it with, their words, and
  // where they are on the page.
  function noteSheet() {
    let DRAFT = 'yaks:note:' + at
    let form = document.createElement('form')
    form.className = 'sheet'
    form.hidden = true
    form.setAttribute('aria-label', 'A note to the Operator')
    let quote = document.createElement('blockquote')
    let words = document.createElement('textarea')
    words.placeholder = 'Ask about this, or say what should change'
    words.setAttribute('aria-label', 'Your note')
    let row = document.createElement('div')
    row.className = 'row'
    let says = document.createElement('p')
    says.setAttribute('role', 'status')
    let cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    let send = document.createElement('button')
    send.type = 'submit'
    send.textContent = 'Send'
    row.append(says, cancel, send)
    form.append(quote, words, row)
    let about = {}
    let keep = () => {
      try {
        sessionStorage.setItem(DRAFT, words.value)
      } catch { /* no storage: the draft lives while the page does */ }
    }
    words.addEventListener('input', keep)
    let shut = () => {
      form.hidden = true
      note.setAttribute('aria-expanded', 'false')
    }
    cancel.addEventListener('click', shut)
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      let say = words.value.trim()
      if (!say) return words.focus()
      send.disabled = true
      says.textContent = 'Sending…'
      try {
        let client = await import(api + 'api/client.js')
        let { conversation } = await client.operatorSend(say, about)
        words.value = ''
        keep()
        says.textContent = 'Sent. The Operator answers in '
        let link = document.createElement('a')
        link.href = conversation
        link.target = '_blank'
        link.textContent = 'your conversation'
        says.append(link, '.')
      } catch (err) {
        if (err?.signIn) {
          says.textContent = 'Sign in to send it: '
          let link = document.createElement('a')
          link.href = err.signIn
          link.textContent = 'sign in'
          says.append(link, '. Your note stays here.')
        } else {
          says.textContent = `It did not send: ${err?.message ?? err}. ` +
            'Your note stays here; Send tries again.'
        }
      } finally {
        send.disabled = false
      }
    })
    return {
      form,
      open: (selection) => {
        about = {
          page: location.href,
          title: document.title,
          ...selection ? { selection: selection.text.slice(0, 2000) } : {},
          ...selection?.section ? { section: selection.section } : {},
          ...version ? { release: Number(version) } : {},
        }
        quote.textContent = selection?.text.slice(0, 600) ?? ''
        try {
          words.value ||= sessionStorage.getItem(DRAFT) ?? ''
        } catch { /* no storage: nothing was kept */ }
        says.textContent = ''
        form.hidden = false
        note.setAttribute('aria-expanded', 'true')
        words.focus()
      },
      shut,
    }
  }

  // The text the reader has selected on the page, and the heading it is
  // under, read as they press the note, before the press moves it.
  let selected = () => {
    let sel = document.getSelection?.()
    let text = sel && !sel.isCollapsed ? String(sel).trim() : ''
    if (!text) return null
    let node = sel.anchorNode
    let el = node?.nodeType == 1 ? node : node?.parentElement
    let section = ''
    for (let up = el; up && !section; up = up.parentElement) {
      for (let s = up; s && !section; s = s.previousElementSibling) {
        if (/^H[1-6]$/.test(s.tagName)) section = s.textContent.trim()
      }
    }
    return { text, ...section ? { section: section.slice(0, 200) } : {} }
  }
  let held = null
  note.addEventListener('pointerdown', () => {
    held = selected()
  })
  note.addEventListener('click', () => {
    if (!sheet.form.hidden) return sheet.shut()
    sheet.open(held ?? selected())
    held = null
  })

  let kept = (on) => {
    try {
      on ? sessionStorage.setItem(KEPT, '1') : sessionStorage.removeItem(KEPT)
    } catch { /* a page with no storage forgets edit mode on reload */ }
  }
  let mode = null
  let close = () => {
    mode?.stop()
    mode = null
    kept(false)
    pencil.setAttribute('aria-pressed', 'false')
  }
  let open = async () => {
    pencil.disabled = true
    try {
      let [client, edit] = await Promise.all([
        import(api + 'api/client.js'),
        import(api + 'api/_edit.js'),
      ])
      mode = edit.editMode(document, client.drafts(), {
        panel,
        at: api,
        ask,
        done: close,
      })
      kept(true)
      pencil.setAttribute('aria-pressed', 'true')
    } catch (e) {
      let says = document.createElement('p')
      says.textContent = `Edit mode could not load. ${
        matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click'
      } the pencil to try again.`
      panel.replaceChildren(says)
      // The reporter (report.js) hears it.
      queueMicrotask(() => {
        throw e
      })
    } finally {
      pencil.disabled = false
    }
  }
  pencil.addEventListener('click', () => mode ? close() : open())

  // Above the badge (badge.js) where it shows in this corner; at the corner
  // where it does not.
  let rise = () => {
    let badge = document.querySelector('yaks-badge')
    let r = badge?.getBoundingClientRect()
    let under = r && r.height && r.bottom > innerHeight - 80 &&
      r.top < innerHeight && r.right > innerWidth - 80
    host.style.setProperty('--rise', under ? `${innerHeight - r.top}px` : '0px')
  }
  let soon = 0
  let again = () => {
    soon ||= requestAnimationFrame(() => {
      soon = 0
      rise()
    })
  }
  let wear = () => {
    document.documentElement.append(host)
    rise()
    addEventListener('resize', again)
    addEventListener('scroll', again, { passive: true })
    new MutationObserver(again).observe(document.documentElement, {
      childList: true,
      attributes: true,
      subtree: false,
    })
    let badge = document.querySelector('yaks-badge')
    if (badge) new MutationObserver(again).observe(badge, { attributes: true })
    let on = false
    try {
      on = sessionStorage.getItem(KEPT) == '1'
    } catch { /* no storage: edit mode starts off */ }
    if (on) open()
  }
  if (document.body) wear()
  else document.addEventListener('DOMContentLoaded', wear, { once: true })
})()
