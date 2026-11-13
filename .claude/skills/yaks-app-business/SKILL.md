---
name: yaks-app-business
description: >
  Use for yaks.app pricing, plans, meter.ts allowances/limits, upgrade/refusal
  text, marketing pages, sign-up/onboarding, billing, gallery, homepage examples
  or audience decisions. Covers its customers, spaces and plans. Business
  principles are business-model; how any marketing page's copy is written is
  marketing-site; platform mechanics are yaks-app.
---

# yaks.app's business

yaks.app is a small product made by a few craftsmen, and few people use it yet.
This is when a business takes its shape: not later in a growth push, but now, in
what the free plan gives away, what the first paid feature is, and the first
sentence a stranger reads. Every price, limit, upgrade prompt and example app
says who yaks.app is for.

The principles are `business-model`, and they hold for every venture; load it
first. This skill is how they land here. Jeff's words are in M-131884 and
M-157410. The strategy is D-448: who yaks.app goes to first, what the
platform still lacks for them, what is measured and what is charged. The people
themselves, organizations first, each with a problem, a week and a use-case, are
D-452. The model for people who come alone, the plans and the site's
information architecture, is D-398.

A public page holds only what a visitor needs. No draft marker, task or memory
id, decision date, or note about the owner, agents or our process, in its text
or anywhere view-source reaches, comments in served HTML, JS and CSS included;
and no line about how the page was written or who wrote it. Notes for us go in
code that isn't served.

## Who it's for

Jeff set the direction on 2026-11-11, and M-157410 holds it whole; read it
before any call about audience. The strategy built on it is D-448.

**First, the organizations near him.** "neighboring businesses, churches,
schools, and other orgs that have similar use-cases", and "People and orgs that
just wouldn't be interacting with this stuff at all otherwise." He wins them one
at a time, in person: "almost every good business starts with the founders
hand-holding every new customer. That's what makes the product so good and
useful. It's built for real problems and not just internet randos." They stay
for something no page can offer: "The *sell* for them is that they know me and
can simply call me if they need something."

So yaks.app is to be "a support + testimonial driven company". The first two
organizations are a church and a township, pilots headed for the Pro plan by the
year (T-153602, T-153603): "we'll do everything we can to make the experience
A+", and their own words are what the next organization hears.

**What the product is for, in that light.** "our role will basically be
automating anything they ask me to do", and "My goal with yaks.app is to
automate that as much as possible." His picture of where software is going is
"something closer to a time-share programmer that is embedded in many local
businesses and solves whatever problems for them that they can". He also means
to use yaks.app himself "to rebuild other software that just isn't very good.
Libraries, schools, churches, businesses, etc.", so what is built for one
organization is published for the next to install. The features worth building
first take something off his hands that an organization asked for, or let the
next organization start from what the last one got.

**Second, people who find it on their own.** "I'd love if people find it
independently, and I think we should still try that. A random sign-up is very
fun!" The home page is for them, and it describes the same product he would
describe in person. Jeff, the same day, on its pitch: "connecting services and
automating things. real work. not just these random sites that anyone could
probably just install right now." /organizations and /churches are the pages he
hands to an office.

yaks.app is its own agent product, designed for non-technical people with
little jargon (M-140239): its pages are where they reach their apps, talk with
their operators and read logs and sessions, and the old web UI is now its
settings. Connecting Claude or ChatGPT stays for people who already know their
assistant well, and is not the center. What the product gives an app that a
chat can't: an address, data that stays, sign-in, the people it's for, on any
phone (M-37845).

The home page leads with the pitch, "Build, host and share web apps"
(M-37845). It led with the Operator from 2026-11-08 until Jeff, 2026-11-13,
verbatim: "please fix the homepage copy to not be about the Operator and go
back to our normal pitch". The Operator is named on it as how changes get
made, and /operator is the page that pitches it.

The individual people who use yaks.app today are literal too. D-452 has
each as a person to write for, and D-398 has the model built on them:

- **Jill** builds tools for her work and for a hobby business, in one free
  space. She gets value and says she'd pay, yet pays nothing because
  she has hit no limit. Her next steps are what the Plus plan carries: her
  custom domain, payments to sell merch, coding taken off her own assistant's
  allowance, and a long list of features waiting in her app.
- **companygardener** is a developer with more ideas than he builds, because of
  friction. He writes very short prompts for unique ideas, and he'd be best
  served by an operator that takes the idea and builds it. Behind him is the
  startup idea person who wants an MVP, then help to make money from it.

The rest in D-398 are guesses, marked as such. A persona nobody on yaks.app
resembles stays a guess until someone who came on their own fits it.

## The space is the unit

Jeff: "the space is where all the data lives and thus we account for the billing
there also." A space is one address, its apps, their data and the people in it.
It's the space that's upgraded, not a person, and what one space uses never
counts against another. Jeff, 2026-11-04: "we gotta re-organize _billing_. it is
now space-specific. so we should do that throughout the website and the internal
portal." Billing is keyed on the space: each space has its own Stripe customer
and at most one subscription (billing.ts `payerFor`), it's paid for, changed and
cancelled from that space's plan settings, and only its owner may pay. A
person's first space is free, and every other space they own is on a paid plan:
Jeff decided one free space on T-131887 ("and yes, one included space."), and
meter.ts `SPACES` holds it. Spaces that were free before the cap stay free. So
the plan is one sentence: each space is free or on a paid plan. Copy never says
a plan, budget or allowance is a person's or an account's.

- **Free is generous with people.** Members, invitations, visitors, publishing,
  installing someone's app and exporting are unlimited on every plan, because
  they're how the next person arrives. Apps, storage, history, model spend, a
  custom domain and taking payments grow as a group comes to rely on a space.
- **The space's owner hears about a limit**, in a sentence that names the space,
  the limit and the one thing to do. A guest who finds an app paused is a
  recommendation we won't get.
- **Every allowance is the space's own.** meter.ts reads each one, and the model
  and voice budget, from the space's meter against the space's plan; nothing
  sums across an owner's spaces. Sandboxes awake are counted per space.

## Upgrades by pull

Jill may never hit a limit, so the Plus plan carries what a maker wants next,
and yaks.app helps them get there: "let's get your recipe site set up with your
custom domain and here are some features i tihnk we could work on." That's the
operator in D-398, an agent that works for the maker, often through their own
assistant or through yaks.app itself. "i'm not talking a salesman."

## The cycle, and the maker's path

Today the cycle runs through Jeff. He visits an organization near him and asks
about its problems. What it asks for is built in its space, mostly by its
Operator, and its staff keep asking by email, chat or a call to him. What was
built for it is published, so the next organization starts from it. Its own
words, a number it gives us and its name, once it says we may use them, are
what the next organization hears. Each pays for its space by the year, and
whatever he did by hand for one is the next thing the platform learns to do.

For people who come alone, the cycle is the older one. Someone asks for an app,
in yaks.app or through their own assistant, and it's live at their address
within minutes. They invite the people it's for. Some of those people have
problems of their own and start a space. The spaces people rely on outgrow free
and pay. The money makes the product better, and the first minute gets more
magical.

At its best, the cycle runs through a maker. She makes a tool for herself,
shares it with her team, publishes it, and then sells it, and the people who buy
it become yaks.app's people too. Jeff: "if we could organically grow her little
tools for herself into a business where she makes money from sharing them with
others, that'd be amazing for her and us." Each step should be a small, obvious
move from the one before. What yaks.app gives at each step, and what's still
missing, is in D-398.

## Price and copy

A flat price per space, with every member free, says _for a person, their team
and the things they run_. yaks.app sells three plans, and meter.ts and the
pricing page hold what each one carries:

- **The Free plan** is a person's first space: 5 apps, 1 GB of app data, 1 GB of
  photos and files and 100 emails a month, with a small badge, no custom domain
  and no payments.
- **The Plus plan** is $9 a month, for any space (T-131888; Jeff: "let's keep $9
  for _now_"): unlimited apps, 10 GB of app data, 50 GB of photos and files,
  2,500 emails a month, a custom domain, payments with Stripe and no badge.
  Whether a Plus space can pay for model use past its budget is T-131904.
- **The Pro plan** is $49 a month or $490 a year, since an organization budgets
  by the year (D-412, T-135234). It carries the Plus plan's allowances and
  adds the Operator built in, so staff ask by email or chat and yaks.app makes
  the change, a larger model budget and support. Past that budget it spends AI
  credit its owner buys in $10 blocks, paid before it is spent, up to a monthly
  cap they set on the plan card: $0 until they choose one, and nothing is ever
  charged past it (meter.ts `creditOf`, billing.ts `buy`).

Jeff expects the organizations to have "plenty of work for us aside from the
platform at $490/yr". That work has no price yet and nothing bills it: a space
pays for its plan and its AI credit, and that is all billing.ts charges. How it
is charged is his to decide (T-157491, with the choices compared in D-448).

Copy is written for a stranger. "Each space is free or on a paid plan" passes;
"Free allowances are yours, not each space's" doesn't. How a marketing page is
written, for any venture, is `marketing-site`; what follows is how it lands on
yaks.app's.

The homepage and the marketing pages speak in the voice the owner asked for,
verbatim (T-32746): "soft and friendly. not this AI-technical analytical modern
nonsense." That voice stays on the marketing pages. The guide under public/docs
is reference, explicit and technical; the owner, verbatim: "the docs are the
place for explicitness and technicality!" (`writing-documentation`).

- Define "space" before you use it.
- Say "the Plus plan" (M-37846) and "the Pro plan".
- Use the one-liner as it stands (M-37845).
- Show live apps from the yourname space (M-37804).
- Let prompts start from the person's own situation (M-37856).

## The evidence, and where it's found

Before you invent a persona, read what people on yaks.app built and whom they
invited, read-only, with `yak admin query`, as D-398 did. Read what they sent
through the connector's `feedback` tool. Count invitations accepted, copies
installed and spaces upgraded, with what tipped each one.

An organization hears of yaks.app from Jeff, or from an organization he already
serves. Its asks are evidence too: what each one was, who made it and how long
it took to be done (the goals in D-448). The record held none of the pilots'
own words on 2026-11-11, so write theirs down verbatim when they come, the way
Jeff's are (M-31946).

Other people find yaks.app through an app someone shared with them, and through
the assistants' connector directories for those who already use one.

## Where it lives

- **The numbers.** workers/yak/meter.ts (`FREE`, `PLUS`, `PRO`, `LETTERS`,
  `BUDGET`, `PRICE`, `YEARLY`, `SPACES`), and site_test.ts holds the pages to
  them. The plan is
  `plan{tier, customer, subscription, status, until, ending, at}` on the space
  (packages/platform/vocab.json), and its AI credit is
  `credit{cap, bought,
  spent}` beside it. Checkout, the billing portal and
  what a subscription changing does to the plan are in workers/yak/billing.ts;
  the provider's webhook doors are @yaks/stripe's, served by
  workers/yak/payment-doors.ts. How metering and refusals work is `yaks-app`.
- **The site.** A home page is data in workers/yak/variant.ts: a name, the page
  it is drawn from and its share of the visitors `/` draws. A page with a share
  is one `/` is split with (today's page, and site/build.tsx, which leads with
  the app a visitor gets). A page with none is a landing page for one audience,
  shown only at its own address, where an ad for that audience points:
  site/churches.tsx at /churches, site/organizations.tsx at /organizations,
  site/townships.tsx at /townships, and the Operator page at /operator.
  /townships says what the township app does (published as `township-office`,
  its sample at yourname.yaks.app/township) and holds no box: its button
  installs that app, and its calculator of Open Meetings Act dates imports the
  sample's own deadlines.js, so the page and every township's meeting pages
  count alike. /organizations sells the Pro plan to any
  organization's office as a web person on staff, and says who is behind
  yaks.app and who fixes mistakes, each promise read from where it is done; it
  never says "Operator" until the plans. /churches keeps the rebuild in a
  church's words and links there for that answer. The box on both
  asks for the web address of the site they have now, and the
  newcomer's Operator reads it and builds theirs from it (newcomer.ts `worded`,
  `REBUILDING`) as a private preview, published only once the person verifies
  that site's domain on their space (`previewing`); words typed there are built
  as an idea. A page's time to build is one measured on a live build. An ad test
  gets a landing page and never changes the home page. A visit to any of them is
  a home page visit in the funnel under that page's name, and so are the click,
  the build begun and the sign-up that follow (`yak admin funnel`, "By home page
  variant"). A page names an audience only with what yaks.app has built for one,
  and names or quotes a customer only once they have said we may, in their own
  words (T-157489; nobody has yet). The home page is workers/yak/site/home.tsx,
  drawn from the kit's parts into the `home` app in the `yak` space (apps/home,
  `deno task content`, then `yak admin push apps/home --space yak --as
  admin@bot.yak.sh`), which the apex answers it from. It carries a
  JSON-LD copy of the plans and a card for each of the three, as
  site/pricing.tsx has; a plan on sale is a card on both pages, never a note
  under them. Next to it are site/pricing.tsx, site/help.tsx and the Limits
  section of docs/technical.md. The link a person pastes into their own agent to
  connect it is /agent, public/agent.md drawn by docs.ts, and the home page,
  /connect and the dashboard offer it. The connector's skills in
  plugins/yaks.app mirror the guide. The plan card a signed-in person sees is
  /manage/billing, in workers/yak/pages.ts.
- **The work.** The two pilots' milestones are T-153602 and T-153603, and
  D-448's tasks hold what the platform lacks for organizations. T-131889
  holds what's left to make yaks.app work as D-398 describes.

When this skill is wrong or missing something, fix it in the same change.
