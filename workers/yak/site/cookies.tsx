import { Time } from '@yaks/ui/parts'
/** @jsxImportSource preact */
import { Page } from './frame.tsx'

export let Cookies = () => (
  <Page
    copy='cookies'
    path='/cookies'
  >
    <div class='Prose_Head'>
      <h1 class='Title Title-page'>Cookies</h1>
      <p class='Prose_When Prose_Text'>
        Last updated <Time written timeZone='UTC' at='2026-11-10T00:00:00Z' />
      </p>
      <p class='Prose_Text'>
        yaks.app sets one cookie, a second one when an ad or a campaign link
        brought you, and a third when you open our home page. This page explains
        what they do.
      </p>
    </div>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>The session cookie</h2>
      <p class='Prose_Text'>
        We set <code class='Prose_Code'>yak_session</code>{' '}
        when you use an app, on yaks.app and its subdomains. Before you sign in,
        it holds a signed identifier for the browser that writes, so you can
        keep editing what you wrote without signing in (guest entries). Signing
        in adds your identity and puts your name on those entries across the
        apps you wrote to. It expires after ninety days of inactivity, and using
        it renews it. We don't use it for visitor counts or advertising.
      </p>
      <p class='Prose_Text'>
        If you clear it, you're signed out, and the browser loses access to any
        guest entries you haven't claimed by signing in. If you refuse it, you
        can't stay signed in or keep your guest identity between requests.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>The campaign cookie</h2>
      <p class='Prose_Text'>
        We set <code class='Prose_Code'>yak_came</code>{' '}
        on yaks.app only when the link you followed carries campaign tags
        (<code class='Prose_Code'>utm_source</code>{' '}
        and the like) or an ad's click id (such as Meta's{' '}
        <code class='Prose_Code'>fbclid</code>). It holds those tags, that id
        and when you arrived, and nothing else: no name, address or session. It
        lets us count which campaigns bring people who sign up, and tell the ad
        network whose ad you clicked that its click led to a visit or a sign-up
        (the <a class='Prose_Link' href='/privacy'>privacy policy</a>{' '}
        says exactly what). It expires after ninety days, and a later campaign
        link replaces it. Clearing or refusing it changes nothing you can see.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>The home page cookie</h2>
      <p class='Prose_Text'>
        We sometimes show different visitors different versions of our home
        page, to learn which one explains yaks.app best. When you open one, we
        set <code class='Prose_Code'>yak_home</code>{' '}
        on yaks.app. It holds the name of the version you saw, and nothing else:
        no name, address or session. It lets us show you the same version next
        time, and count how many visitors to each version went on to sign up. It
        expires after ninety days. Clearing or refusing it changes only which
        version of the home page you see.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Other cookies</h2>
      <p class='Prose_Text'>
        We don't set third-party cookies, and no ad network's code runs on our
        pages. Cloudflare, which hosts yaks.app, may set its own cookie to tell
        people from bots. That cookie is a security measure and isn't used to
        build a profile of you. Our{' '}
        <a class='Prose_Link' href='/privacy'>privacy policy</a>{' '}
        has more about what we collect.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Apps on yaks.app</h2>
      <p class='Prose_Text'>
        Apps in a yaks.app space use the session cookie, and we set no other
        cookie for them.
      </p>
    </section>
    <section class='Prose_Section'>
      <h2 class='Prose_Heading'>Contact</h2>
      <p class='Prose_Text'>
        Questions about cookies go to{' '}
        <a class='Prose_Link' href='mailto:hello@yaks.app'>hello@yaks.app</a>.
      </p>
    </section>
  </Page>
)
