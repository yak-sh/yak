// The hosted settings door: fields use the kit's Save behavior, and write
// through the same forms as the settings pages and their existing tools, or
// through the page graph where the page drawn from it says so
// (@yaks/platform/page-parts `SAVE_THROUGH`).
import { bindSave, type SaveBinding } from '@yaks/ux/save'
import { tips } from '@yaks/ui/parts'
import { CallError } from '@yaks/tools/errors'
import { settingsDrafts } from '@yaks/platform/settings-drafts-browser'
import { LEAVE, PAGE } from '@yaks/ui/navigate'
import { SAVE_THROUGH, type SavingForm } from '@yaks/platform/page-parts'

let report = (error: unknown) =>
  queueMicrotask(() => {
    throw error
  })
let rejected = (response: Response, message: string) =>
  response.status >= 500
    ? new Error(message)
    : new CallError('arguments', message)

let refused = async (response: Response) => {
  let type = response.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    let answer = await response.json().catch(() => null)
    return answer?.say ?? answer?.message ?? answer?.error?.message
  }
  let doc = new DOMParser().parseFromString(await response.text(), 'text/html')
  return doc.querySelector('.Notice-negative')?.textContent?.trim()
}

/** The page's settings, with drafts kept under its signed-in person. */
export let settings = (root: Document = document) => {
  let forms = root.querySelectorAll<HTMLFormElement>('form[data-save]')
  if (!forms.length) return
  tips(root)
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
      let through = (form as SavingForm)[SAVE_THROUGH]
      if (through) {
        let out = await through(body)
        if (typeof out != 'object') return out
        if (out.to && out.to != location.pathname) destination = out.to
        return out.say
      }
      let response = await fetch(form.action, {
        method: 'POST',
        body,
        headers: { accept: 'application/json' },
      })
      if (response.status == 202) {
        let answer = await response.json()
        throw new CallError('arguments', answer.message)
      }
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
      // What the save said, beside the Save bar's button. Renaming a space
      // moves this page: the answer names its new address, and the page
      // there says it (manage.ts `answered`).
      let answer = response.headers.get('content-type')
          ?.includes('application/json')
        ? await response.json().catch(() => null)
        : null
      if (
        answer?.to && new URL(answer.to, location.href).pathname !=
          location.pathname
      ) destination = answer.to
      return typeof answer?.say == 'string' ? answer.say : undefined
    },
    saved: () => {
      if (destination) location.assign(destination)
    },
  })
  // A page brought in place (@yaks/ui/navigate) takes the page before away:
  // what was bound to it lets go.
  root.addEventListener(LEAVE, () => {
    binding?.close()
    drafts.close()
  }, { once: true })
  return binding
}

if (typeof document != 'undefined') {
  settings()
  document.addEventListener(PAGE, () => settings())
}
