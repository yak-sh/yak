// A person's own invite (referral.ts): the code it carries, the links its QR
// codes open, and the page that shows them, over a directory in memory.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { rows } from './directory-rows-probe.ts'
import type { Env } from './env.ts'
import { desk } from './pages.ts'
import { codeIn, codeOf, invitation } from './referral.ts'

let { dir } = rows()
let person = async (name: string) => {
  let eid = crypto.randomUUID()
  await dir.stamp({
    entities: [{
      entity: { eid },
      person: {},
      email: { address: `${eid}@example.com` },
      doc: { title: name },
    }],
  })
  return eid
}
let NUMBER = '+18885550100'
let texting = {
  PHONE_SENDER: { via: 'pinnacle', number: NUMBER },
  PINNACLE_API_KEY: 'test-only',
} as Env
let jeff = await person('Jeff')
let first = await invitation(texting, dir, jeff)
let again = await invitation(texting, dir, jeff)
let code = codeIn(first.said)!
let ana = await person('Ana')
let tries = [code, 'xxxxx']
let taken = await codeOf(dir, ana, () => tries.shift()!)
let mailOnly = await invitation({} as Env, dir, jeff)
let { document } = parseHTML(
  await desk({ space: 'jeff', view: 'invite', apps: [], referral: first })
    .text(),
)

test("a person's invite carries their own code, the same every time, and the code finds them", async () => {
  equal(first.said, `Hi yaks.app, sign me up! (invite from Jeff, ${code})`)
  equal(again.said, first.said)
  equal(await dir.referrer(code), jeff)
})

test('a code somebody holds is never minted for another person', () => {
  equal(taken, 'xxxxx')
})

test('the invite opens a text to the number, or a letter to the sign-up address, holding the words', () => {
  equal(first.text, `sms:${NUMBER}?&body=${encodeURIComponent(first.said)}`)
  equal(
    first.mail,
    `mailto:signup@yaks.app?subject=Sign%20me%20up&body=${
      encodeURIComponent(first.said)
    }`,
  )
})

test('with no provider to text through, the invite is the letter alone', () => {
  equal(mailOnly.text, null)
  equal(mailOnly.mail, first.mail)
})

test('the invite page shows each way as a code to scan, and what sending agrees to', () => {
  let codes = [...document.querySelectorAll('.Invite_Code')]
  equal(codes.map((a) => a.getAttribute('href')), [first.text, first.mail])
  ok(codes.every((a) => a.querySelector('svg[role=img] path')))
  ok(document.querySelector('.Invite_Words')?.textContent == first.said)
  let said = document.querySelector('.Invite_Way .Note')?.textContent ?? ''
  ok(said.includes('Reply STOP to stop'), said)
})
