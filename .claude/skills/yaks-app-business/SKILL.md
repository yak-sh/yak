---
name: yaks-app-business
description: >
  yaks.app's own business: who it is for (Jill, companygardener and the
  personas in D-131886), the space as the unit of data and billing, the free
  and Plus plans, the growth cycle and the maker's path, and where the plans,
  prices and marketing pages live. Use it whenever you touch yaks.app's
  pricing, plans, allowances or limits (meter.ts ceilings, upgrade prompts,
  refusal text), its marketing site (workers/yak/public/index.html,
  pricing.html, help.html), sign-up or onboarding copy, the billing page, the
  gallery or a home-page example, or decide who a yaks.app feature is for, even
  if the request only says "make this paid", "add a limit", "tweak the home
  page", "write the copy" or "who would use this?". The principles behind it,
  for any venture, are `business-model`; how the platform meters and bills is
  `yaks-app`; how prose reads is `writing-documentation`; a proposal for the
  owner is `design-docs`.
---

# yaks.app's business

yaks.app is a small product made by a few craftsmen, and few people use it yet.
This is when a business takes its shape: not later in a growth push, but now,
in what the free plan gives away, what the first paid feature is, and the first
sentence a stranger reads. Every price, limit, upgrade prompt and example app
says who yaks.app is for.

The principles are `business-model`, and they hold for every venture; load it
first. This skill is how they land here. Jeff's words are in M-131884, and the
model in full, with the personas, the cycle, the plans and the site's
information architecture, is D-131886.

## Who it's for

People with a specific problem, at work, at home or in something they run on
the side, that no off-the-shelf app fits, and who already ask an assistant for
help. The moment they need an app comes inside that chat; yaks.app gives it
what a chat can't: an address, data that stays, sign-in, the people it's for,
on any phone (M-37845). The people we want already pay for that assistant: "if
they aren't paying for claude, they probably just don't need our product."

The first personas are literal people who use yaks.app, and D-131886 has each
in full:

- **Jill** is the wedge. She builds tools for her work and for a hobby
  business, in one free space. She gets value and says she'd pay, yet pays
  nothing because she has hit no limit. Her next steps are what the Plus plan
  carries: her custom domain, payments to sell merch, coding taken off her own
  assistant's allowance, and a long list of features waiting in her app.
- **companygardener** is a developer with more ideas than he builds, because of
  friction. He writes very short prompts for unique ideas, and he'd be best
  served by an operator that takes the idea and builds it. Behind him is the
  startup idea person who wants an MVP, then help to make money from it.

The rest in D-131886 are guesses, marked as such. A persona nobody on yaks.app
resembles stays a guess until someone who came on their own fits it.

## The space is the unit

Jeff: "the space is where all the data lives and thus we account for the
billing there also." A space is one address, its apps, their data and the
people in it. It's the space that's upgraded, not a person, and what one space
uses never counts against another. A person's first space is free, and every
other space they own is on the Plus plan (T-131887, built under T-131891). So
the plan is one sentence: each space is free or on the Plus plan.

- **Free is generous with people.** Members, invitations, visitors,
  publishing, installing someone's app and exporting are unlimited on every
  plan, because they're how the next person arrives. Apps, storage, history,
  model spend, a custom domain and taking payments grow as a group comes to
  rely on a space.
- **The space's owner hears about a limit**, in a sentence that names the
  space, the limit and the one thing to do. A guest who finds an app paused is
  a recommendation we won't get.
- **Today's code still pools.** meter.ts pools emails, builds and the model
  budget across an owner's spaces; T-131890 moves all of it onto the space.

## Upgrades by pull

Jill may never hit a limit, so the Plus plan carries what a maker wants next,
and yaks.app helps them get there: "let's get your recipe site set up with your
custom domain and here are some features i tihnk we could work on." That's the
operator in D-131886, an agent that works for the maker, often through their
own assistant. "i'm not talking a salesman."

## The cycle, and the maker's path

Someone asks their assistant for an app, and it's live at their address within
minutes. They invite the people it's for. Some of those people have problems of
their own and start a space. The spaces people rely on outgrow free and pay.
The money makes the product better, and the first minute gets more magical.

At its best, the cycle runs through a maker. She makes a tool for herself,
shares it with her team, publishes it, and then sells it, and the people who
buy it become yaks.app's people too. Jeff: "if we could organically grow her
little tools for herself into a business where she makes money from sharing
them with others, that'd be amazing for her and us." Each step should be a
small, obvious move from the one before. What yaks.app gives at each step, and
what's still missing, is in D-131886.

## Price and copy

A flat price per space, with every member free, says *for a person, their team
and the things they run*. The Plus plan is $9 a month for now (T-131888; Jeff:
"let's keep $9 for *now*"), and whether a Plus space can pay for model use past
its budget is T-131904.

Copy is written for a stranger. "Each space is free or on the Plus plan"
passes; "Free allowances are yours, not each space's" doesn't.

- Define "space" before you use it.
- Say "the Plus plan" (M-37846).
- Use the one-liner as it stands (M-37845).
- Show live apps from the yourname space (M-37804).
- Let prompts start from the person's own situation (M-37856).

## The evidence, and where it's found

Before you invent a persona, read what people on yaks.app built and whom they
invited, read-only, with `yak admin query`, as D-131886 did. Read what they
sent through the connector's `feedback` tool. Count invitations accepted,
copies installed and spaces upgraded, with what tipped each one.

People realize they need an app while they're talking to their assistant, so
that's where yaks.app should be found: the assistants' connector directories,
and an app someone shared with them.

## Where it lives

- **The numbers.** workers/yak/meter.ts (`FREE`, `PLUS`, `LETTERS`, `BUDGET`,
  `PRICE`, `SPACES`), and site_test.ts holds the pages to them. The plan is
  `plan{tier, customer, subscription, status, until, ending, at}` on the space
  (packages/platform/vocab.json). Checkout, the billing portal and the Stripe
  webhook are in workers/yak/billing.ts. How metering and refusals work is
  `yaks-app`.
- **The site.** The home page is workers/yak/public/index.html, which carries a
  JSON-LD copy of the plans. Next to it are pricing.html, help.html and the
  Limits section of docs/technical.md. The connector's skills in
  plugins/yaks.app mirror the guide. The plan card a signed-in person sees is
  /manage/billing, in workers/yak/pages.ts.
- **The work.** T-131889 holds what's left to make yaks.app work as D-131886
  describes.

When this skill is wrong or missing something, fix it in the same change.
