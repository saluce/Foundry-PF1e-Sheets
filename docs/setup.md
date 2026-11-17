# PF1 Inventory · Sheets Sync 0.3

For Foundry VTT 13 and Pathfinder 1e 11.x. Review inventory changes, distribute loot, and manage named banks and separate wallets.

## Install

In Foundry Setup → Add-on Modules → Install Module, use:

https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest/download/module.json

Enable the module and open **Inventory · Sheets Sync** from the Actors sidebar as GM. Back up your world first. Automated tests pass; live Google/Foundry integration still needs a test-world check.

## Two separate spreadsheets

Import Player Inventory.xlsx and Private GM Records.xlsx as two separate native Google spreadsheets. New campaigns can use the blank release templates. Share only the player workbook. Keep the private workbook restricted to your account and explicitly approved GMs.

Character tabs and Party Loot are editable. Wallets has separate balances per owner/location. Banks is a derived view: edit items on their original inventory tab. Expand grouped details for known values, weights and properties. Hidden IDs and registry tabs improve readability; hiding does not provide privacy. Sort entire rows to keep IDs with items. Preserve headers and IDs.

The campaign conversion keeps existing names and values public, and moves original notes to the private workbook. Player notes start empty. Review coloured uncertain quantities and the private Review tab. Confirm missing coin denominations before syncing; blank does not mean zero. This cannot undo past disclosures.

## Private connection setup

1. Create a **new standalone project** at https://script.google.com using the private workbook owner's account. Do not attach it to the shared workbook or share the project with players.
2. Replace Code.gs with google-apps-script/Code.gs. Enable **Show appsscript.json manifest file** in Project Settings and replace that file with google-apps-script/appsscript.json.
3. Under Script properties add PUBLIC_SPREADSHEET_ID and GM_SPREADSHEET_ID, using each URL's ID between /d/ and /edit. Optional GM_ALLOWED_EMAILS is a comma-separated list of trusted GM email addresses. Groups, domains and link sharing on the private file are rejected.
4. Run **setupConnection** and authorise access. This checks permissions and installs dropdowns/protections. Copy TOKEN from Script properties and keep it private. Omitting GM_SPREADSHEET_ID creates an empty private workbook instead of importing converted records.
5. Deploy → New deployment → Web app: **Execute as Me**, access **Anyone**. Every endpoint action requires the secret. Copy the /exec URL.
6. Enter the endpoint URL and secret in Foundry module settings as GM. Map characters to actors, run **Preview sync**, review conflicts, then apply.

The private file must be owned by the deployment account. Permission checks fail closed. If Google requests it, enable the Google Drive API for the script's Cloud project and retry setup. Keep OAuth credentials and the secret out of spreadsheets and public source.

## Private details and reveals

Use **GM item details / reveal** to edit true name, actual value, secret properties and GM notes. The row ID links to the private record. Save keeps details private. Select name, value or properties independently to copy chosen discoveries into the public sheet. GM notes cannot be revealed. Preview sync afterwards to update Foundry.

Private records stay out of player worksheets, Foundry item flags and public recovery data. Native PF1 mechanics/descriptions retain normal Foundry visibility; this feature does not hide arbitrary system effects or descriptions from actor owners.

## Loot, locations and characters

Add unclaimed items to Party Loot, preview sync, then use **Distribute loot** for full items or partial stacks. Choose recipient storage; Carried is the default. Private records follow IDs and are copied before splitting. Failed private preservation blocks transfer. Unpack linked containers first. Sheet-only items become basic loot; existing native items retain mechanics.

Use **Manage locations (GM)** for banks and stashes. Wallets has independent owner/location balances. Only Carried uses native actor currency. Move items and coins before removing an occupied location. New locations do not create balances automatically.

For a new character copy the blank Character tab, preserve headers, and give it a unique tab name. As spreadsheet owner, unhide Owners and add its Owner/Tab pair, rerun setupConnection, then map it in Foundry. Owners is protected. Never place secrets in hidden shared tabs or link the private file using IMPORTRANGE.

## Upgrade from 0.2

Archive the old workbook and script. Version 0.3 requires the new workbook schema and a **fresh private standalone deployment**. Replacing code in a shared bound script is unsafe. Use the converted pair, configure the new endpoint, and review first pairing. Legacy module notes are preserved privately before removing their old Foundry flags. Recovery snapshots are in the private workbook's _Recovery tab.

Keep the project, binding and IDs after pairing. Update the web-app deployment to a new version after bridge changes. Back up both workbooks and the world before migration/restoration.

## Tests

Run `node --test tests/*.test.mjs` in the public repository. Thirty checks cover reconciliation, transfers, locations, permission failures, private migration and selective reveals. Public templates and release assets contain no campaign data.
