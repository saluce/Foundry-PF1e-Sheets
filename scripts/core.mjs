export const ID = "pf1-sheet-inventory-sync";
export const ITEM_FIELDS = ["owner", "name", "quantity", "uses", "price", "weight", "sell", "storage", "notes"];
export const WALLET_FIELDS = ["owner", "storage", "pp", "gp", "sp", "cp"];
export const ITEM_HEADERS = ["Sync ID", "Owner", "Item", "Qty", "Uses", "Unit value (gp)", "Unit weight (lb)", "Sell", "Storage", "Notes"];
export const WALLET_HEADERS = ["Sync ID", "Owner", "Storage", "Platinum", "Gold", "Silver", "Copper"];
export const fieldsFor = r => r.kind === "wallet" ? WALLET_FIELDS : ITEM_FIELDS;
export const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const escapeHTML = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]));

export function numeric(value, label, {blank = null, integer = false} = {}) {
  if (value === "" || value == null) return blank;
  if (typeof value === "boolean" || !/^\d+(\.\d+)?$/.test(String(value).trim())) throw Error(`${label}: enter a non-negative number.`);
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw Error(`${label}: enter ${integer ? "a whole" : "a finite"} number.`);
  return n;
}
export function truth(value) {
  if ([true, 1, "1", "true", "yes", "x"].includes(typeof value === "string" ? value.toLowerCase().trim() : value)) return true;
  if ([false, 0, "0", "false", "no", "", null, undefined].includes(typeof value === "string" ? value.toLowerCase().trim() : value)) return false;
  throw Error(`Unrecognised sell flag: ${value}`);
}
export function normalize(r) {
  const out = {kind: r.kind, id: String(r.id ?? "").trim(), owner: String(r.owner ?? "").trim(), storage: String(r.storage || "Carried").trim()};
  if (!["item", "wallet"].includes(out.kind) || !out.id || !out.owner) throw Error("Every row needs a kind, Sync ID and Owner.");
  if (out.storage.length > 120 || /[\u0000-\u001f]/.test(out.storage)) throw Error(`${out.owner}: use a location name of at most 120 characters.`);
  if (out.kind === "wallet") {
    for (const k of ["pp", "gp", "sp", "cp"]) out[k] = numeric(r[k], `${out.owner} ${k}`, {blank: 0, integer: true});
  } else {
    out.name = String(r.name ?? "").trim();
    if (!out.name) throw Error("An item name is required.");
    out.quantity = numeric(r.quantity, `${out.name} quantity`, {blank: 1});
    for (const k of ["uses", "price", "weight"]) out[k] = numeric(r[k], `${out.name} ${k}`, {integer: k === "uses"});
    out.sell = truth(r.sell);
    out.notes = String(r.notes ?? "");
  }
  return out;
}
export function indexRows(rows) {
  const map = new Map();
  const wallets = new Set();
  for (const raw of rows) {
    const r = normalize(raw);
    if (map.has(r.id)) throw Error(`Duplicate Sync ID: ${r.id}`);
    if (r.kind === "wallet") {
      const key = JSON.stringify([r.owner, r.storage]);
      if (wallets.has(key)) throw Error(`Duplicate wallet: ${r.owner} / ${r.storage}`);
      wallets.add(key);
    }
    map.set(r.id, r);
  }
  return map;
}

// Field-by-field reconciliation. Only confirmed Foundry removals propagate;
// deleting a sheet row never deletes an in-game item.
export function reconcile(baseRows, foundryRows, sheetRows) {
  const base = indexRows(baseRows), local = indexRows(foundryRows), remote = indexRows(sheetRows);
  const rows = [], changes = [], conflicts = [];
  for (const id of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(id), r = remote.get(id), b = base.get(id);
    if (!l && r && b) {
      const unchanged = fieldsFor(r).every(f => same(r[f], b[f]));
      if (unchanged) changes.push({id, field:"row", target:"Sheet", value:"Remove: item no longer in mapped Foundry inventories"});
      else {
        rows.push(structuredClone(r));
        conflicts.push({id,field:"row",foundry:null,sheet:r});
      }
      continue;
    }
    if (!l || !r) {
      const row = structuredClone(l || r);
      rows.push(row);
      changes.push({id, field: "row", target: l ? "Sheet" : "Foundry", value: row, restored: !!b});
      continue;
    }
    if (l.kind !== r.kind || (b && b.kind !== l.kind)) throw Error(`Row kind changed: ${id}`);
    const merged = {kind:l.kind, id};
    for (const field of fieldsFor(l)) {
      if (same(l[field], r[field])) merged[field] = l[field];
      else if (b && same(l[field], b[field])) {
        merged[field] = r[field]; changes.push({id, field, target:"Foundry", value:r[field]});
      } else if (b && same(r[field], b[field])) {
        merged[field] = l[field]; changes.push({id, field, target:"Sheet", value:l[field]});
      } else {
        merged[field] = l[field];
        conflicts.push({id, field, foundry:l[field], sheet:r[field]});
      }
    }
    rows.push(merged);
  }
  return {rows, changes, conflicts};
}

export function resolvePlan(plan, choices) {
  const rows = structuredClone(plan.rows), byId = new Map(rows.map(r => [r.id, r]));
  for (const [i, c] of plan.conflicts.entries()) {
    if (!["foundry", "sheet"].includes(choices[i])) throw Error("Choose a side for every conflict.");
    if(c.field === "row") {
      if(c[choices[i]] === null) byId.delete(c.id);
      else byId.set(c.id,structuredClone(c[choices[i]]));
    } else byId.get(c.id)[c.field] = c[choices[i]];
  }
  return [...indexRows([...byId.values()]).values()];
}

export function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {cell += '"'; i++;} else quoted = !quoted;
    } else if (c === "," && !quoted) {row.push(cell); cell = "";}
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed quote in CSV.");
  if (cell || row.length) {row.push(cell); rows.push(row);}
  return rows;
}

// Convert the screenshot's A:F inventory plus currency block and BANK table.
// Uncertain legacy values are rejected rather than guessed.
export function convertLegacy(csv, owner, uuid, {stackValues=false,stackWeights=false} = {}) {
  const grid = parseCSV(csv), out = [];
  const header = grid.findIndex(r => /^item$/i.test(r[0]?.trim()) && /^qty$/i.test(r[1]?.trim()));
  if (header < 0) throw Error("Couldn't find Item and Qty in columns A and B.");
  for (const [offset, r] of grid.slice(header + 1).entries()) {
    if (!r[0]?.trim()) continue;
    const name = r[0].trim();
    const quantity=numeric(r[1],`${name} quantity`,{blank:1});
    const convert=(value,stack,label)=>{
      const n=numeric(value,label);
      if(n===null || !stack) return n;
      if(!quantity && n) throw Error(`${name}: a zero-quantity stack has a non-zero ${label}.`);
      return quantity?n/quantity:0;
    };
    out.push(normalize({kind:"item", id:uuid(), owner, name, quantity, uses:r[2],
      price:convert(r[3],stackValues,"value"),weight:convert(r[4],stackWeights,"weight"),sell:r[5],storage:"Carried",
      notes:r[1]?.trim()?"":"Quantity was blank in the old sheet; imported as 1. Please check."}));
  }
  const bank = grid.flatMap((r, ri) => r.map((v, ci) => /^bank$/i.test(v.trim()) && /^qty$/i.test(r[ci+1]?.trim()) ? [ri,ci] : null).filter(Boolean));
  for (const [ri, ci] of bank) for (const r of grid.slice(ri + 1)) {
    if (!r[ci]?.trim()) continue;
    out.push(normalize({kind:"item", id:uuid(), owner, name:r[ci], quantity:r[ci+1], storage:"Bank"}));
  }
  const currencies = {platinum:"pp", gold:"gp", silver:"sp", copper:"cp"};
  const wallet = {kind:"wallet", id:uuid(), owner, storage:"Carried", pp:0,gp:0,sp:0,cp:0};
  let count = 0;
  for (const r of grid) for (let ci = 6; ci < r.length; ci++) {
    const coin = currencies[r[ci]?.trim().toLowerCase()];
    if (coin) { wallet[coin] = numeric(r[ci+1], `${owner} ${coin}`, {blank:0,integer:true}); count++; }
  }
  if (count) out.push(normalize(wallet));
  return out;
}
