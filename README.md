# PF1 Inventory · Sheets Sync

A Foundry VTT 13 module for Pathfinder 1e: review and synchronise inventories with Google Sheets, distribute loot, and track separate GM-managed banks and stashes.

## Install

In Foundry Setup, select **Add-on Modules → Install Module** and paste:

```text
https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest/download/module.json
```

Enable **PF1 Inventory · Sheets Sync** in your world. Open the Actors sidebar as GM and choose **Inventory · Sheets Sync**.

## Connect Google Sheets

Download the blank workbook from [the latest release](https://github.com/saluce/Foundry-PF1e-Sheets/releases/latest), open it as a native Google Sheet, and follow the [setup guide](docs/setup.md). The Google Apps Script source is in [google-apps-script/Code.gs](google-apps-script/Code.gs). The spreadsheet can remain private; the endpoint uses a GM connection secret.

## Features

- Two-way item and coin sync with previews and conflict choices.
- Separate character inventory and party loot tables.
- GM-controlled full-item and partial-stack transfers.
- GM-managed storage locations with independent wallets.
- Legacy inventory-tab conversion and pre-sync recovery snapshots.

New sheet-only items become basic loot. Existing native items retain their PF1 mechanics. Linked containers must be unpacked before using the transfer tool.

## Status and tests

Version **0.2.0**, for **Foundry 13** and **PF1 11.x**. Automated checks cover reconciliation, item transfers, rollback, named banks, permissions and the Google bridge. Run:

```sh
node --test tests/sync.test.mjs
```

Live Google / Foundry integration still needs verification in a test world. Back up your world before first use. No campaign inventories or recovery backups are included in this repository.
