# PF1 Inventory · Sheets Sync

A first version for **Foundry VTT 13** and **Pathfinder 1e 11.x**. It runs alongside the PCGen importer; it does not change that module.

## Named storage locations (version 0.2)

The GM selects **Manage locations (GM)** in the module window to add banks, town vaults, chests or stashes. `Carried` is reserved for inventory and coins physically carried by an actor. The blank template includes **Town Bank** as an example location. No empty wallets or balances are created for new locations.

Inventory and Loot use the **Storage** dropdown. Wallets has a separate row for each **Owner + Storage location**, so the same owner can have independent balances in Town Bank and another town. Stored items keep their exact location on the Foundry item, and stored wallets keep separate balances in module flags. Only Carried uses the native PF1 currency wallet.

**Distribute loot** lets the GM choose the recipient's storage location, defaulting to Carried. Withdrawing from a bank therefore makes the item carried by its recipient. The source of a partial stack retains its original location.

The Google Locations tab supplies the dropdowns. **Set up connection** protects that tab from other spreadsheet editors; the spreadsheet owner and authenticated GM module can maintain it. The module rejects unknown locations. A location cannot be removed while sheet rows or mapped Foundry items / wallets still use it. Move the rows and sync first. Old generic `Bank` flags remain supported and are upgraded without combining them with named-bank balances.

After installing 0.2, replace Code.gs, run **setupConnection** again, then update the Google web-app deployment to a new version. Existing IDs, connection secret and sheet pairing are preserved. Use the updated workbook; it includes the Locations list. The extra Locations and Migration notes tabs are not treated as inventories.

## What you get

- **Inventory**: one table for character gear, filterable by Owner.
- **Loot**: a separate table for unclaimed loot. Default Owner: `Party Loot`.
- **Wallets**: separate carried and named-location balances of platinum, gold, silver and copper.
- A GM **Preview sync** screen with field-by-field conflict choices.
- A GM **Distribute loot** tool for full items and partial stacks, preserving existing PF1 item data.
- An old-sheet importer: read the original Google spreadsheet once and convert all compatible character tabs, including item cell notes. CSV import is also available per tab.

The workbook is intentionally blank. The screenshots informed the layout; they were not treated as a complete inventory export.

## 1. Install the Foundry module

1. From Foundry Setup, open Add-on Modules → Install Module and paste the manifest URL from the repository README.
2. Confirm the result is `Data/modules/pf1-sheet-inventory-sync/module.json`.
3. Open the world and enable **PF1 Inventory · Sheets Sync** under Manage Modules.
4. As GM, open the Actors sidebar. Look for **Inventory · Sheets Sync**.

The public installation manifest is https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest/download/module.json .

## 2. Connect the Google Sheet

1. Upload **Party Inventory Template.xlsx** to Google Drive and open it with Google Sheets. If needed, select **File → Save as Google Sheets** so you have a native Google spreadsheet.
2. In that spreadsheet, select **Extensions → Apps Script**.
3. Replace the editor's `Code.gs` with the supplied `google-apps-script/Code.gs`. Save.
4. In Apps Script, run **setupConnection** once. Approve Google's spreadsheet access request. It adds a connection secret and checks the workbook headers. The secret is shown in a spreadsheet dialog; return to the spreadsheet if the editor appears to be waiting.
5. **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Deploy and copy the URL ending in `/exec`.
6. In Foundry, **Configure Settings → Module Settings → PF1 Inventory · Sheets Sync**, enter that URL and the connection secret. Save.

The spreadsheet itself can remain private. The endpoint uses your long connection secret to authorise reads and writes. Keep that secret with the GM. The module stores it and the sync baseline in the GM's browser, not in shared world settings. Configure the connection separately if you change browsers; the first preview in a new browser will reconcile without the old baseline and may show more conflicts. No Google password or OAuth token is put into Foundry.

If your Google Workspace account does not permit Anyone web apps, this deployment method will need an administrator-approved alternative. Do not publish the sheet to the web to work around it.

The supplied `appsscript.json` is optional; the editor can infer permissions from Code.gs. If you choose to use it, enable **Show appsscript.json manifest file in editor** in Project Settings and replace its contents too.

After editing the script, update its deployment to a **new version**. Saving the editor alone does not update an existing web app.

## 3. Bring in the old inventory

Reload the new sheet to see **Inventory Sync → Import old character tabs**. Paste the **old** spreadsheet URL. Your old sheet is read only.

The importer detects `Item` / `Qty` in columns A / B and reads A:F as Item, Qty, Uses, Value, Weight, Sell. The tab name becomes Owner. It also detects `BANK` / `Qty` to the right and a carried currency block labelled Gold / Silver / Copper / Platinum.

You choose whether the old Value and Weight columns contain **unit** or **whole-stack** amounts. Whole-stack amounts are divided by quantity. Missing quantities become 1 and get a review note; missing prices and weights stay unknown. Existing numeric zeroes stay zeroes. Invalid numbers stop the import before new rows are written. The final dialog lists the imported tabs and skipped tabs; you can cancel.

Repeated import into an owner that already has rows is blocked to prevent duplication. The native importer copies item cell notes. CSV cannot preserve cell notes. Colours, comments and other arbitrary calculation blocks are not migrated. Totals in the new layout are recalculated.

If a source tab has an unexpected layout, leave it out of this import and use the CSV converter on a copy with the supported columns. Your original sheet stays intact.

## 4. Choose owners and actors

In Foundry's sync window choose **Choose owners / actors**. Map every imported Owner to its character actor. Owner labels do not have to equal actor names.

For a blank template, enter owner names in **Additional owners**, one per line. The next screen lets you choose each actor. You can also seed the sheet by mapping existing Foundry actors and syncing their current inventory.

Create a PF1 loot / NPC actor called **Party Loot**, then map Owner `Party Loot` to it. To create a chest or other separate loot location, map another actor and add that owner name to the Apps Script `LOOT_OWNERS` script property (comma-separated). All those owners use the separate Loot tab. Other owners use Inventory.

**Map both sides of a trade before syncing.** The module only sees mapped world actors. It does not inventory unlinked scene-token actors, compendiums or off-world loot.

Select **Preview sync**. On the first sync, unique identical item names within an owner are linked; differing values are shown as conflicts. Give duplicate / ambiguous items distinct names before the first link. After linking, stored IDs take over and names can change safely. The Sync ID column is hidden during setup; keep it intact when sorting or moving rows.

Review changes and choose a side for every conflict, then **Apply reviewed sync**. The module downloads a recovery JSON of the mapped actors and pre-sync sheet values before writes.

## 5. Distribute loot

1. Add unclaimed gear to the Loot tab with Owner `Party Loot`, then sync it to that actor. Alternatively, add native PF1 items directly to the actor and sync them to the sheet.
2. In Foundry choose **Distribute loot**.
3. Choose **From**, **To**, the item and quantity; confirm **Transfer loot**.
4. **Preview sync** again. The item moves to the recipient's sheet inventory; a partial stack leaves the remaining quantity on the source actor.

The transfer tool is GM-controlled. It does not implement player requests, approval notifications, merchant pricing or currency trading. Move coins by editing the appropriate Wallets balances and reviewing sync. Existing third-party trades can also be reflected on the next sync, but compatibility with your particular module must be checked in a test world.

Individual physical items are cloned with their PF1 data. Distinct stacks stay separate to retain their charges and magic properties. Linked containers / children and linked ammunition relationships are refused by this transfer tool; unpack them and use PF1's native sheet tools. Chest **actors** work as separate loot locations.

## What sync changes

Items: name, quantity, uses, unit price, unit weight, carried/banked state, sell flag and module notes. Notes and sale flags are stored on the Foundry item by this module. They do not replace its rich description.

Native PF1 items keep their type, actions, descriptions, effects and other rules. New sheet-only items become basic `loot` entries. A sheet name such as “Wand of Shocking Grasp” does not create spell mechanics automatically. For a working weapon, wand or magic item, add the native item in Foundry first, then sync it.

Uses sync to the native uses counter for items that have a uses period. For basic loot, Uses is a module tracking field. Clearing a native uses value in the sheet does not clear the native counter; use a numeric zero for spent charges.

Carried coins use PF1's native currency fields. Stored coins are kept in module flags separately for each location. Stored items stay on the actor with `carried: false` and their named location in module flags. Native bag containment is preserved but is not editable through this sheet.

The sheet's weight is listed quantity × unit weight. It is not PF1 encumbrance: coin weight, size, magical containers, movement speed and carrying capacity remain Foundry's responsibility. Unknown prices and weights remain blank; listed totals only include known values. Sale totals use half the listed value for items flagged Sell.

## Changes, removals and recovery

- Edit either side, then preview. Independent field edits merge. Editing the same field differently on both sides requires a choice.
- Removing a sheet row does **not** remove an item in Foundry; the row is restored on sync. Spend / remove items in Foundry, or set Qty to zero.
- A previously synced item removed from all mapped Foundry inventories is removed from the sheet **after review**. If its sheet row also changed, choose whether to keep the removal or recreate the sheet version.
- Transfer ownership in Foundry. Changing Owner on an already-linked sheet item is blocked. Keep a wallet's Owner fixed. A stored wallet may be renamed to another registered location; keep carried and stored wallets separate and move coins between them by editing balances.
- Do not trade or edit during Apply. Use one GM browser for syncing at a time. Apps Script locks serialise its requests, but cannot lock people editing cells or provide a transaction spanning Google Sheets and Foundry.
- Intervening edits detected before Apply invalidate the preview. Google checks the sheet fingerprint again when committing. Foundry writes happen first; if Google's write fails or its confirmation is lost, the baseline stays unchanged and the module tells you to inspect the sheet and preview again. Repeating the sync uses item IDs to avoid duplicate creations.
- `_Last sync backup` is a hidden Google tab containing the input cells from before the most recent sheet write. Google version history is also available. The downloaded recovery JSON contains raw actor snapshots, the baseline and sheet state; it is not a single-actor Foundry import file. Keep a normal Foundry world backup before first use. Automatic whole-world restoration is not included.
- A world is paired with one sheet. Changing to a different sheet after pairing is blocked in this version. Test with a copy of the world and spreadsheet first.

## Validation and limits

Automated tests cover three-way reconciliation, duplicate / invalid inputs, CSV conversion, native item data preservation, full and partial transfers, copied IDs from external splits, rollback on a source failure, GM permissions, repeat sync, endpoint authentication, changed-sheet rejection and loot-tab routing. The template's item totals and coin conversion were calculated and checked, and all four tabs were rendered for inspection.

**Live verification is still required:** no Google deployment or running Foundry world was connected during development. Google sign-in / browser access, real PF1 data-model hooks and third-party trading behavior must be checked in your test world before using this with the campaign's authoritative inventory.

Run the local checks with `node --test tests/sync.test.mjs` from the project folder.

Implementation references: [Foundry 13 Actor API](https://foundryvtt.com/api/v13/classes/foundry.documents.Actor.html), [PF1 physical items](https://foundryvtt-pathfinder1-053b2a.gitlab.io/classes/pf1.documents.item.ItemPhysicalPF.html), [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [Apps Script Content service](https://developers.google.com/apps-script/guides/content).
