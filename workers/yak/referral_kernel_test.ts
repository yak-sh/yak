// A person's invite page through the whole kernel: the dashboard's side
// links it, and it draws their own code, the same on every visit.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { managePath } from '@yaks/platform/routes'
import { kernel, signIn } from './probe.ts'
import { codeIn } from './referral.ts'

let k = await kernel()
let them = await signIn(k)
let open = async (path: string) =>
  parseHTML(
    await (await k.at('yaks.app', path, {
      headers: { cookie: them.cookie },
    })).text(),
  ).document
let invite = managePath('invite')
let page = await open(invite)
let again = await open(invite)
let side = await open(managePath('profile'))
let codeOf = (d: Document) =>
  codeIn(d.querySelector('.Invite_Words')?.textContent ?? '')
let [code, kept] = [codeOf(page), codeOf(again)]
let linked = side.querySelector(`.SideNav_Link[href="${invite}"]`)
let mail = page.querySelector('.Invite_Code[href^="mailto:"]')

test("the dashboard links a person's invite, which carries their own code on every visit", () => {
  ok(linked)
  ok(code, 'the page shows the words with a code')
  equal(kept, code)
  ok(mail?.querySelector('svg path'), 'the letter is a code to scan')
  ok(mail?.getAttribute('href')?.includes(code!))
})
