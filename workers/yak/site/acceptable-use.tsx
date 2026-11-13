import { Time } from '@yaks/ui/parts'
/** @jsxImportSource preact */
import { Page } from './frame.tsx'

export let AcceptableUse = () => (
  <Page
    copy='acceptable-use'
    path='/acceptable-use'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Acceptable use policy</h1>
      <p class='Prose_When Prose_Text'>
        Last updated <Time written timeZone='UTC' at='2026-11-01T00:00:00Z' />
      </p>
      <p class='Prose_Text'>
        This policy lists what you may not do on yaks.app.
      </p>
    </div>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Prohibited uses</h2>
      <p class='Prose_Text'>You may not:</p>
      <ul class='Prose_List'>
        <li class='Prose_Item'>
          Break the law, or use a yaks app to harm anyone.
        </li>
        <li class='Prose_Item'>
          Post anything that sexualizes a child. We remove it, close the account
          and report it, without exception.
        </li>
        <li class='Prose_Item'>
          Harass, threaten or campaign against people, including through an open
          app that anyone can write in.
        </li>
        <li class='Prose_Item'>
          Post other people's work, writing or pictures without the right to do
          so.
        </li>
        <li class='Prose_Item'>
          Host malware, phishing pages, or anything impersonating a bank, a
          company or a person.
        </li>
        <li class='Prose_Item'>
          Use invitations to send bulk email to people who didn't ask for it.
        </li>
        <li class='Prose_Item'>
          Try to access someone else's space, or probe the separation between
          spaces.
        </li>
        <li class='Prose_Item'>
          Mine cryptocurrency, run a proxy or a botnet, or use yaks.app as
          storage for files no app serves.
        </li>
        <li class='Prose_Item'>
          Send so much traffic that other people can't use the service.
        </li>
      </ul>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Enforcement</h2>
      <p class='Prose_Text'>
        We usually contact you first and ask about the problem. We remove
        clearly harmful content immediately and close the account. Where we can
        tell you why, we will.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Reporting violations</h2>
      <p class='Prose_Text'>
        Email{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>
        {' '}
        and tell us where the content is and what's wrong. We'll look at it the
        same day where we can.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Terms of service</h2>
      <p class='Prose_Text'>
        This policy is part of our{' '}
        <a class='Prose_Link' href='/terms'>terms of service</a>.
      </p>
    </section>
  </Page>
)
