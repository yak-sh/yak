/**
 * The Profile page (Your account), drawn from the person's rows
 * (./account-rows.ts, ./side-rows.ts): their name, their email, "Show when
 * I'm online" and the space `/manage` opens first, saved through the page's
 * Save bar; the chat platforms they linked their own account on; and the
 * browsers signed in as them, each signed out on its own or all at once. The
 * server draws it for the first paint, and the browser draws it again as the
 * rows move (./profile-browser.ts).
 *
 * @module
 */
import { createElement as h, type ReactNode as Kids } from 'react'
import { Card } from '@yaks/ui/Card'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Rows } from '@yaks/ui/Rows'
import { Time } from '@yaks/ui/Time'
import type { Account, ChatLink, SignedIn } from './account-rows.ts'
import { showing } from './friends-view.ts'
import {
  fieldsOf,
  heading,
  labeled,
  option,
  said,
  saving,
  send,
} from './page-parts.ts'
import { MANAGE, managePath } from './routes.ts'
import type { Picked } from './side-rows.ts'
import { browserName } from './signed-in.ts'

/** What the Profile page says about itself beside the rows: whose it is, the
 * zone its spaces answer under, and the browser it is open in. */
export type ProfileView = {
  person: string
  apex: string
  session?: string
}

/** A browser signed in as the person, by its session's eid. */
export type Browser = SignedIn & { eid: string }

let named = (s: Pick<Picked, 'slug' | 'title'>) => s.title || s.slug

/** The Profile page: `account`, the person's `spaces`, their `browsers` and
 * the chat platforms they `link` their own account on. */
export let profileView = (
  view: ProfileView,
  account: Account,
  spaces: Picked[],
  browsers: Browser[],
  links: ChatLink[],
): Kids[] => {
  let mine = spaces.filter((s) => s.owner)
  let first = mine.find((s) => s.own)?.slug ?? ''
  return [
    saving(
      managePath('profile'),
      h(
        Card,
        null,
        heading('Profile'),
        fieldsOf(
          labeled(
            'your-name',
            'Your name',
            h(Field, {
              id: 'your-name',
              name: 'name',
              maxlength: 60,
              autocomplete: 'name',
              placeholder: 'Dana',
              value: account.name,
            }),
            'Shown to people in every space you’re in.',
          ),
          h(
            Form.Field,
            null,
            h(Form.Label, { as: 'p' }, 'Email'),
            h('p', null, account.email),
          ),
          showing(account.hidden, 'profile'),
          mine.length > 1
            ? labeled(
              'your-first',
              'Open first',
              h(
                Field,
                { choose: true, id: 'your-first', name: 'first' },
                mine.map((s) => option(s.slug, named(s), s.slug == first)),
              ),
              `The space ${view.apex}${MANAGE} opens.`,
            )
            : null,
        ),
      ),
    ),
    ...links.map(linkCard),
    h(
      Card,
      null,
      heading('Signed-in browsers'),
      h(
        Rows,
        null,
        signedIn(browsers, view.session).map((b) =>
          browserRow(b, b.eid == view.session)
        ),
      ),
      signOut('all', 'Sign out everywhere'),
      said(),
    ),
  ]
}

// Signing out `session`, or every browser: written through the page graph
// (./profile-browser.ts), and without a script, posted.
let signOut = (
  session: string,
  label: string,
  as: typeof Rows.Form = Form,
) =>
  h(
    as,
    {
      method: 'post',
      action: managePath('profile'),
      'data-sign-out': session,
    },
    h(Form.Hidden, { name: 'session', value: session }),
    send(label),
  )

// A chat platform the person links their own account on, so every space's
// Operator knows it is them there: the accounts they linked, and a button to
// link one, which leaves to sign in there (manage.ts `linkFrom`) and comes
// back.
let linkCard = (l: ChatLink) =>
  h(
    Card,
    { key: l.integration },
    heading(l.platform),
    h(
      'p',
      null,
      l.accounts.length
        ? `Linked as ${
          l.accounts.join(', ')
        }. Your Operator knows it’s you there.`
        : `Link your ${l.platform} account so your Operator knows it’s you there.`,
    ),
    h(
      Form,
      { method: 'get', action: managePath('profile') },
      h(Form.Hidden, { name: 'link', value: l.integration }),
      h(Form.Hidden, { name: 'enable', value: l.integration }),
      send(
        l.accounts.length ? 'Link another account' : `Connect ${l.platform}`,
      ),
    ),
  )

// The person's browsers, the one asking first, then the newest sign-in.
let signedIn = (browsers: Browser[], session?: string) =>
  browsers.toSorted((a, b) =>
    Number(b.eid == session) - Number(a.eid == session) ||
    (b.at ?? '').localeCompare(a.at ?? '')
  )

// One browser by what it is and where it runs (./signed-in.ts), then where
// and when it signed in; its raw user-agent is the name's tip.
let browserRow = (b: Browser, here: boolean) =>
  h(
    Rows.Item,
    { key: b.eid, 'data-key': b.eid },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { title: b.agent }, browserName(b.agent)),
      h(
        Rows.Meta,
        null,
        joined([
          b.place,
          b.at ? ['signed in ', h(Time, { at: b.at })] : null,
          here ? 'this browser' : null,
        ]),
      ),
    ),
    signOut(b.eid, 'Sign out', Rows.Form),
  )

let joined = (parts: Kids[]) =>
  parts.filter(Boolean).flatMap((p, i) => i ? [' · ', p] : [p])
