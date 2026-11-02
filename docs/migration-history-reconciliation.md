# Migration history reconciliation

No remote migration metadata has been changed.

## Remote-only versions

`20261007135357`, `20261007185155`, `20261007202416`, `20261007211605`,
`20261007211717`, `20261007211730`, `20261007211736`, `20261007212251`,
`20261007212415`, `20261007212426`, `20261008114140`.

## Local-only versions

`20261007000001`, `20261007000002`, `20261007000003`, `20261007140000`,
`20261007190000`, `20261007210000`, `20261008000000`, `20261009000000`,
`20261010000000`, `20261011000000`.

## Live baseline

The live schema contains the task/workspace/finance structures expected by the
application, including `work_items`, `categories`, `workspaces`,
`workspace_members`, `transaction_categories`, and their relevant constraints.

## Safe resolution

Create an authoritative schema baseline from a database export, then establish
a new repository migration baseline in a reviewed branch. Do not invent the
missing SQL or use `supabase migration repair` until the intended metadata
history is independently verified.
