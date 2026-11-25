# give — gifts to a fund, with no keys and no code

A phone-first giving page: the fund's name first, then once or monthly, an
amount, and a box to cover the card fee that shows the exact amount it adds. The
gift is paid on Stripe's page, through the space's own connected Stripe account,
and yaks.app takes no fee on it. The owner sees what has come in and sends
year-end statements from the same page.

The whole shape is written up at <https://yaks.app/docs/selling.md>, under
Donations.

## Deploying it

    app_new(slug: 'give', title: 'Give', access: 'public')
    app_files(app: 'give', files: [ … every file in this folder … ])
    app_deploy(app: 'give')

Then, once per space, the seller connects Stripe from the space's Selling page.
Until they have, the Give button says giving is not open yet.

The first deploy writes the fund in `seed/` into the store, once. Rename it and
set its holder with `graph_apply` (see `NOTES.md`).

## The files

| file         | what it is                                             |
| ------------ | ------------------------------------------------------ |
| `index.html` | the giving page, and the owner's totals and statements |
| `gift.js`    | the donor's choice and the owner's totals, no DOM      |
| `seed/`      | one fund, written once per store                       |
| `NOTES.md`   | how to change the fund                                 |

There is no `vocab.json`: `fund` and `gift` are the platform's own words.
