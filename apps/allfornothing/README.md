# All for Nothing

The public scripture page at allfornothing.org, hosted in its own
`allfornothing` space on yaks.app. The app serves its homepage at the space
root; `/index` also opens it, `/up` is the health page, and missing pages
answer 404.

`index.html` holds all ten passages in their original order. `style.css` keeps
the linked word emphasis on hover, light and dark colours, and the red-letter
passages. The page needs no JavaScript, worker, connections or stored rows.

The port corrects Romans 6:32 to Romans 6:23, balances the two quotations from
John, adds a page title and semantic main, and makes the text fit narrow
screens.

The original application is `jeffpeterson/all_for_nothing` at
`bbabe950b688c041fcc36a02a2c633111d68b5e5`. Its shared Rails dependencies are
CafeCar `3ad4adb2d841618a0c5f119acc9c92ae05726774` and CNC
`37b12ffef5afe572b768f75269f2fbfa83d90b8a`. The source and pinned dependencies
contain no domain models or migrations; the Rails database configuration names
primary, cache, queue and cable databases. The source does not prove those
databases empty.

A full source Git bundle, the original rendered page and shared stylesheet, and
the pre-move DNS records are backed up privately under
`~/.yak/backups/railway/allfornothing-2026-11-10/`. Railway's local login has no
credential and the accessible 1Password vault has no Railway credential, so the
Railway databases could not be inspected or dumped. They were not read or
changed, and their services remain for T-152787 to handle after backup.

The old Railway project is `3b25f43f-5946-4eac-ab82-5565168c4a2a`, production
environment `c24fa588-cfac-488f-9fcb-d3a8ff5ac1e7`; service
`07b7d2c6-8bfd-4abf-8a60-d06432ca56de`; its public origin is
`a4xvwz8p.up.railway.app`. GitHub's deployment records identify this project.
