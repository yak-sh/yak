/** @jsxImportSource preact */
import { Page } from './frame.tsx'

export let AcceptableUse = () => (
  <Page
    name='Acceptable use policy'
    description='What you may not do on yaks.app.'
    path='/acceptable-use'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Acceptable use policy</h1>
      <p class='Prose_When'>Last updated 1 November 2026</p>
      <p>This policy lists what you may not do on yaks.app.</p>
    </div>
    <section>
      <h2>Prohibited uses</h2>
      <p>You may not:</p>
      <ul>
        <li>Break the law, or use a yaks app to harm anyone.</li>
        <li>
          Post anything that sexualizes a child. We remove it, close the account
          and report it, without exception.
        </li>
        <li>
          Harass, threaten or campaign against people, including through an open
          app that anyone can write in.
        </li>
        <li>
          Post other people's work, writing or pictures without the right to do
          so.
        </li>
        <li>
          Host malware, phishing pages, or anything impersonating a bank, a
          company or a person.
        </li>
        <li>
          Use invitations to send bulk email to people who didn't ask for it.
        </li>
        <li>
          Try to access someone else's space, or probe the separation between
          spaces.
        </li>
        <li>
          Mine cryptocurrency, run a proxy or a botnet, or use yaks.app as
          storage for files no app serves.
        </li>
        <li>Send so much traffic that other people can't use the service.</li>
      </ul>
    </section>
    <section>
      <h2>Enforcement</h2>
      <p>
        We usually contact you first and ask about the problem. We remove
        clearly harmful content immediately and close the account. Where we can
        tell you why, we will.
      </p>
    </section>
    <section>
      <h2>Reporting violations</h2>
      <p>
        Email <a href='mailto:hello@yaks.app'>hello@yaks.app</a>{' '}
        and tell us where the content is and what's wrong. We'll look at it the
        same day where we can.
      </p>
    </section>
    <section>
      <h2>Terms of service</h2>
      <p>
        This policy is part of our <a href='/terms'>terms of service</a>.
      </p>
    </section>
  </Page>
)
