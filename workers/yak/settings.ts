// The hosted settings door: fields use the kit's Save behavior, and write
// through the same forms as the settings pages and their existing tools.
import { bindSave, type SaveBinding } from '@yaks/ux/save'
import { CallError } from '@yaks/tools/errors'
import { settingsDrafts } from './settings-draft-browser.ts'

let report = (error: unknown) =>
  queueMicrotask(() => {
    throw error
  })
let rejected = (response: Response, message: string) =>
  response.status >= 500
    ? new Error(message)
    : new CallError('arguments', message)

let allow = async (offer: HTMLInputElement) => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new CallError(
      'arguments',
      'This browser cannot show notifications. Choose another way.',
    )
  }
  if (await Notification.requestPermission() != 'granted') {
    throw new CallError(
      'arguments',
      'Notifications are blocked for yaks.app in this browser. Allow them in its settings, then save again.',
    )
  }
  let worker = await navigator.serviceWorker.register('/push.js')
  await navigator.serviceWorker.ready
  let key = Uint8Array.from(
    atob(offer.dataset.push!.replaceAll('-', '+').replaceAll('_', '/')),
    (c) => c.charCodeAt(0),
  )
  let sub = await worker.pushManager.getSubscription() ??
    await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    })
  let response = await fetch(offer.dataset.at!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),
  })
  if (!response.ok) {
    throw rejected(
      response,
      (await response.json().catch(() => null))?.message ??
        'This browser could not be allowed. Try again.',
    )
  }
}

let refused = async (response: Response) => {
  let type = response.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    let answer = await response.json().catch(() => null)
    return answer?.message ?? answer?.error?.message
  }
  let doc = new DOMParser().parseFromString(await response.text(), 'text/html')
  return doc.querySelector('.Notice-negative')?.textContent?.trim()
}

/** The page's settings, with drafts kept under its signed-in person. */
export let settings = (root: Document = document) => {
  let forms = root.querySelectorAll<HTMLFormElement>('form[data-save]')
  if (!forms.length) return
  let by = root.querySelector<HTMLElement>('[data-save-person]')?.dataset
    .savePerson
  let destination = ''
  let binding: SaveBinding | undefined
  let drafts = settingsDrafts({
    scope: location.pathname,
    by,
    report: (error) => {
      if (binding) binding.report(error)
      else report(error)
    },
  })
  binding = bindSave(root, {
    drafts,
    report: (error) => {
      if (!(error instanceof CallError)) report(error)
    },
    save: async (form: HTMLFormElement, body: FormData) => {
      let offer = form.querySelector<HTMLInputElement>('[data-push]:checked')
      if (offer) await allow(offer)
      let response = await fetch(form.action, {
        method: 'POST',
        body,
        headers: { accept: 'text/html, application/json' },
      })
      if (!response.ok) {
        throw rejected(
          response,
          await refused(response) ??
            'Your changes could not be saved. They are kept here. Try again.',
        )
      }
      if (response.redirected && new URL(response.url).pathname == '/login') {
        throw new CallError(
          'arguments',
          'Sign in again to save. Your changes are kept on this device.',
        )
      }
      // Renaming a space changes this page's path. The form's own redirect
      // names its new address; other settings stay on the page being edited.
      if (form.querySelector('[name=space]') && response.redirected) {
        destination = response.url
      }
    },
    saved: () => {
      if (destination) location.assign(destination)
      else location.reload()
    },
  })
  return binding
}

if (typeof document != 'undefined') settings()
