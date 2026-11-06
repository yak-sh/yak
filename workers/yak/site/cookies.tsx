/** @jsxImportSource preact */
import { Page } from './frame.tsx'

export let Cookies = () => (
  <Page
    name='Cookies'
    description='yaks.app sets one cookie, so you stay signed in.'
    path='/cookies'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Cookies</h1>
      <p class='Prose_When'>Last updated 1 November 2026</p>
      <p>yaks.app sets one cookie. This page explains what it does.</p>
    </div>
    <section>
      <h2>The cookie we set</h2>
      <p>
        We set <code>yak_session</code>{' '}
        when you use an app, on yaks.app and its subdomains. Before you sign in,
        it holds a signed identifier for the browser that writes, so you can
        keep editing what you wrote without signing in (guest entries). Signing
        in adds your identity and puts your name on those entries across the
        apps you wrote to. It expires after ninety days of inactivity, and using
        it renews it. We don't use it for visitor counts or advertising.
      </p>
      <p>
        If you clear it, you're signed out, and the browser loses access to any
        guest entries you haven't claimed by signing in. If you refuse it, you
        can't stay signed in or keep your guest identity between requests.
      </p>
    </section>
    <section>
      <h2>Other cookies</h2>
      <p>
        We don't set advertising cookies, analytics cookies or third-party
        cookies. Cloudflare, which hosts yaks.app, may set its own cookie to
        tell people from bots. That cookie is a security measure and isn't used
        to build a profile of you. Our <a href='/privacy'>privacy policy</a>
        {' '}
        has more about what we collect.
      </p>
    </section>
    <section>
      <h2>Apps on yaks.app</h2>
      <p>
        Apps in a yaks.app space use this same cookie, and we set no other
        cookie for them.
      </p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>
        Questions about cookies go to{' '}
        <a href='mailto:hello@yaks.app'>hello@yaks.app</a>.
      </p>
    </section>
  </Page>
)
