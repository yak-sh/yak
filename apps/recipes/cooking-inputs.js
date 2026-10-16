// Custom cooking durations are drafts until the guarded timer write accepts them.
import { validSeconds } from './cooking-model.js'

export const durationPlace = (step) => `cooking:${step}:seconds`

export function durationHTML(step, disabled) {
  const id = String(step).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
  return `<form class="cook-seconds" data-cook-duration data-id="${id}">
    <label>Custom duration (seconds)<input type="text" inputmode="numeric"
      data-cook-draft="${id}" autocomplete="off" ${
    disabled ? 'disabled' : ''
  }></label>
    <button type="submit" ${disabled ? 'disabled' : ''}>Set duration</button>
  </form>`
}

/** Rebind after render, without closing the root's shared draft desk. */
export function bindDurations(root, desk, { run, bundles }) {
  const unbind = [...root.querySelectorAll('[data-cook-draft]')].map((input) =>
    desk.bind(input, durationPlace(input.dataset.cookDraft))
  )
  const submit = (event) => {
    const form = event.target
    if (!form.matches('[data-cook-duration]')) return
    event.preventDefault()
    const button = form.querySelector('button')
    // Match the step's quick controls: a custom write cannot race one of them.
    button.dataset.id = form.dataset.id
    void run(button, async () => {
      const input = form.querySelector('input')
      const text = input.value
      const seconds = validSeconds(text)
      const changes = await bundles(form.dataset.id, seconds)
      if (desk.text(durationPlace(form.dataset.id)) !== text) {
        throw new Error('Duration changed while saving. Submit it again.')
      }
      if (!await desk.spend(durationPlace(form.dataset.id), changes)) {
        throw new Error('Duration was not saved. Your input has been kept.')
      }
    })
  }
  root.addEventListener('submit', submit)
  return () => {
    root.removeEventListener('submit', submit)
    for (const off of unbind) off()
  }
}
