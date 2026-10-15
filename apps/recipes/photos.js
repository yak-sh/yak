// The platform serves this module beside the page; it is absent from the repo.
let { apply, subscribe, upload, was } = await import(
  new URL('./api/client.js', import.meta.url).href
)

// Standalone DOM island: render once, append it, then wirePhotos(root, …).
// Never replace this root on an unrelated recipe/cooking subscription update.
// update(rows) accepts graph bundles, including an empty initial set. destroy()
// stops subscriptions/listeners; in-flight writes still finish normally.
export function renderPhotos(recipeId, rows = [], canWrite = false) {
  let root = document.createElement('section')
  root.className = 'recipe-photos'
  root.dataset.recipe = recipeId
  root.dataset.writes = String(canWrite)
  root.setAttribute('aria-label', 'Recipe photos')
  root.innerHTML = `
    <h3 class="sec">Photos</h3>
    <div class="recipe-photos-list"></div>
    <p class="recipe-photos-empty">No photos yet. Add a picture of your dish.</p>
    <form class="recipe-photos-upload">
      <label>Choose photos <input type="file" accept="image/*" multiple></label>
      <button type="submit" class="btn edit">Upload photos</button>
    </form>
    <p class="recipe-photos-status" role="status" aria-live="polite"></p>
    <p class="recipe-photos-error" role="alert" hidden></p>`
  updateCards(root, recipeId, rows)
  writable(root, canWrite)
  return root
}

function writable(root, canWrite) {
  root.dataset.writes = String(canWrite)
  root.querySelector('form').hidden = !canWrite
  for (let input of root.querySelectorAll('.recipe-photo input')) {
    input.readOnly = !canWrite
    input.placeholder = canWrite ? 'Add a caption' : 'No caption'
  }
  for (let retry of root.querySelectorAll('[data-retry]')) {
    retry.disabled = !canWrite
  }
}

function refId(value) {
  return typeof value === 'string' ? value : value?.eid
}

function ordered(recipeId, rows) {
  return rows.filter((r) => refId(r.photo?.recipe) === recipeId)
    .slice().sort((a, b) =>
      (a.photo.ord ?? 0) - (b.photo.ord ?? 0) ||
      a.entity.eid.localeCompare(b.entity.eid)
    )
}

function card(row) {
  let el = document.createElement('figure')
  el.className = 'recipe-photo'
  el.dataset.photo = row.entity.eid
  el.innerHTML = `
    <img loading="lazy" decoding="async">
    <p class="recipe-photo-image-error" role="status" hidden>Photo could not be displayed.</p>
    <figcaption>
      <label>Caption <input type="text" placeholder="Add a caption"></label>
      <span class="recipe-photo-status" role="status" aria-live="polite"></span>
      <span class="recipe-photo-error" role="alert" hidden></span>
      <button type="button" class="btn quiet" data-retry hidden>Retry caption</button>
    </figcaption>`
  let img = el.querySelector('img')
  img.addEventListener('error', () => {
    el.querySelector('.recipe-photo-image-error').hidden = false
  })
  img.addEventListener('load', () => {
    el.querySelector('.recipe-photo-image-error').hidden = true
  })
  return el
}

// Keyed patches preserve the input node, focus, selection and unsent text.
function updateCards(root, recipeId, rows, states = new Map()) {
  let list = root.querySelector('.recipe-photos-list')
  let cards = new Map([...list.children].map((el) => [el.dataset.photo, el]))
  let selected = ordered(recipeId, rows)
  let keep = new Set(selected.map((r) => r.entity.eid))
  let cursor = list.firstElementChild
  for (let row of selected) {
    let id = row.entity.eid
    let el = cards.get(id) ?? card(row)
    let img = el.querySelector('img')
    // upload().url is an immediate display URL, not a stored property. The
    // relative blob door also works when this app is installed under a new slug.
    let src = `./api/blob/${encodeURIComponent(refId(row.photo.blob))}`
    if (img.getAttribute('src') !== src) img.setAttribute('src', src)
    img.alt = row.photo.caption || 'Recipe photo'
    let input = el.querySelector('input')
    let state = states.get(id)
    if (state?.pending && row.photo.caption === state.pendingCaption) {
      state.pending = false
      delete state.pendingCaption
      input.disabled = false
    }
    if (state?.awaiting && row.photo.caption === input.value) {
      state.awaiting = false
      state.pending = false
      input.disabled = false
      el.querySelector('.recipe-photo-status').textContent = 'Saved'
    }
    if (
      !state?.dirty && !state?.running && !state?.awaiting &&
      input !== document.activeElement
    ) {
      input.value = row.photo.caption ?? ''
    }
    if (el !== cursor) list.insertBefore(el, cursor)
    cursor = el.nextElementSibling
  }
  for (let [id, el] of cards) {
    if (keep.has(id)) continue
    let state = states.get(id)
    if (state?.dirty || state?.running || el.contains(document.activeElement)) {
      // A remote delete must not silently eat what somebody is typing, nor
      // should a caption edit recreate a deleted photo.
      let error = el.querySelector('.recipe-photo-error')
      error.textContent =
        'This photo was removed elsewhere. Copy your caption before leaving.'
      error.hidden = false
      el.querySelector('[data-retry]').hidden = true
      if (state) state.removed = true
    } else {
      el.remove()
      states.delete(id)
    }
  }
  root.querySelector('.recipe-photos-empty').hidden = list.children.length > 0
}

export function wirePhotos(root, recipeId, rows = [], onError = () => {}) {
  if (root.dataset.recipe !== recipeId) {
    throw new Error('Photo root belongs to another recipe')
  }
  let canWrite = root.dataset.writes === 'true'
  let current = rows
  let states = new Map()
  let disposed = false
  let uploading = false
  let selection = []
  let next = 0
  let form = root.querySelector('form')
  let picker = form.querySelector('input')
  let button = form.querySelector('button')
  let status = root.querySelector('.recipe-photos-status')
  let error = root.querySelector('.recipe-photos-error')
  let guard = was(recipeId)
  let message = (e) => e instanceof Error ? e.message : String(e)
  let report = (e, node = error) => {
    node.textContent = message(e)
    node.hidden = false
    onError(e)
  }
  let update = (latest) => {
    current = latest
    if (!disposed) {
      updateCards(root, recipeId, latest, states)
      writable(root, canWrite)
      for (let el of root.querySelectorAll('.recipe-photo')) {
        let state = states.get(el.dataset.photo)
        if (state?.dirty && !state.running && !state.pending && !state.failed) {
          void save(el, state)
        }
      }
    }
  }

  async function save(el, state) {
    if (!canWrite || state.running || state.pending || state.removed) return
    let input = el.querySelector('input')
    let note = el.querySelector('.recipe-photo-status')
    let fault = el.querySelector('.recipe-photo-error')
    let retry = el.querySelector('[data-retry]')
    state.running = true
    state.failed = false
    fault.hidden = true
    retry.hidden = true
    try {
      // Serialize writes for this input. A slow older write cannot overtake
      // the newer caption; no detached draft map or pre-upload text is kept.
      while (canWrite && state.dirty && !state.removed) {
        let caption = input.value
        note.textContent = 'Saving…'
        let receipt = await apply({
          entity: { eid: el.dataset.photo },
          $was: { photo: { recipe: await guard } },
          photo: { caption },
        })
        state.awaiting = true
        state.pending = !!receipt?.pending &&
          !current.some((row) =>
            row.entity.eid === el.dataset.photo &&
            row.photo?.caption === caption
          )
        state.dirty = input.value !== caption
        if (state.pending) {
          state.pendingCaption = caption
          input.disabled = true
          note.textContent = 'Queued — waiting for the store'
          return
        }
      }
      note.textContent = state.removed ? '' : 'Saved'
    } catch (e) {
      state.failed = true
      note.textContent = 'Not saved'
      retry.hidden = !!state.removed
      report(e, fault)
    } finally {
      state.running = false
    }
  }

  function edited(event) {
    if (!canWrite) return
    let input = event.target
    if (!input.matches('.recipe-photo input')) return
    let el = input.closest('.recipe-photo')
    let state = states.get(el.dataset.photo) ?? { dirty: false, running: false }
    states.set(el.dataset.photo, state)
    state.dirty = true
    void save(el, state)
  }
  function retried(event) {
    if (!canWrite) return
    let retry = event.target.closest('[data-retry]')
    if (!retry) return
    let el = retry.closest('.recipe-photo')
    let state = states.get(el.dataset.photo)
    if (state) void save(el, state)
  }
  function chosen() {
    selection = [...picker.files].map((file) => ({
      file,
      eid: crypto.randomUUID(),
    }))
    next = 0
    error.hidden = true
    status.textContent = ''
  }
  async function send(event) {
    event.preventDefault()
    if (!canWrite || uploading) return
    if (!selection.length) {
      status.textContent = 'Choose a photo first.'
      picker.focus()
      return
    }
    uploading = true
    picker.disabled = button.disabled = true
    error.hidden = true
    let queued = 0
    try {
      // next advances only once the photo row is stored. Retrying a partly
      // failed selection does not repeat its already-added photo rows.
      for (; next < selection.length; next++) {
        let { file, eid } = selection[next]
        status.textContent = `Uploading ${next + 1} of ${selection.length}…`
        let sent = await upload(file)
        let ord = Math.max(
          -1,
          ...ordered(recipeId, current).map((r) => r.photo.ord ?? 0),
        ) + 1
        let row = {
          entity: { eid },
          photo: { recipe: recipeId, blob: sent.eid, caption: '', ord },
        }
        // Sent bytes live on the platform's blob + attachment rows. Only the
        // reference and recipe-specific facts belong on this photo entity.
        let receipt = await apply(row)
        // A pending receipt is queued, not persisted. Let the subscription
        // display it when it actually lands; never retry a queued write.
        if (receipt?.pending) queued++
        else {update([
            ...current.filter((r) => r.entity.eid !== row.entity.eid),
            row,
          ])}
      }
      selection = []
      picker.value = ''
      next = 0
      status.textContent = queued
        ? `${queued} photo write(s) queued — they will appear when the store recovers.`
        : 'Photos added. You can now add captions.'
    } catch (e) {
      status.textContent =
        'Upload not finished. Press Upload photos to retry the remaining files.'
      report(e)
    } finally {
      uploading = false
      picker.disabled = button.disabled = false
    }
  }

  root.addEventListener('input', edited)
  root.addEventListener('click', retried)
  picker.addEventListener('change', chosen)
  form.addEventListener('submit', send)
  update(rows)
  let unsubscribe = () => {}
  try {
    unsubscribe = subscribe(
      `.photo.recipe=${encodeURIComponent(recipeId)}`,
      update,
    )
  } catch (e) {
    report(e)
  }
  let hasUnsaved = () =>
    uploading || selection.length > 0 ||
    [...states.values()].some((state) =>
      state.dirty || state.running || state.pending
    )
  return {
    update,
    hasUnsaved,
    setWritable(value) {
      canWrite = !!value
      writable(root, canWrite)
    },
    // Call before the parent replaces its DOM; call the returned function
    // after reattaching root. Restores selection without scrolling the page.
    preserveFocus() {
      let active = document.activeElement
      if (!root.contains(active)) return () => {}
      let start = active.selectionStart
      let end = active.selectionEnd
      let direction = active.selectionDirection
      return () => {
        if (!active.isConnected) return
        active.focus({ preventScroll: true })
        if (typeof start === 'number' && active.setSelectionRange) {
          active.setSelectionRange(start, end, direction)
        }
      }
    },
    // A parent must explicitly confirm discarding failed/pending input before
    // tearing down this island. Same-recipe rerenders should move root instead.
    destroy({ discard = false } = {}) {
      if (hasUnsaved() && !discard) return false
      disposed = true
      unsubscribe()
      root.removeEventListener('input', edited)
      root.removeEventListener('click', retried)
      picker.removeEventListener('change', chosen)
      form.removeEventListener('submit', send)
      return true
    },
  }
}
