import {ID, normalize, indexRows, same} from "./core.mjs";

const physical = item => item.isPhysical ?? ["weapon", "equipment", "consumable", "loot", "container"].includes(item.type);
const readFlag = item => item.flags?.[ID] ?? {};
const walletKey = id => "w" + [...id].map(c=>c.codePointAt(0).toString(16).padStart(6,"0")).join("");
export function assertGM() {
  if (!game.user?.isGM) throw Error("Only a GM can synchronise inventories.");
  if (game.system.id !== "pf1" || String(game.version).split(".")[0] !== "13") throw Error("This version requires Pathfinder 1 on Foundry 13.");
}
export function mappedActors(mapping) {
  const ids = new Set();
  return Object.entries(mapping).map(([owner, id]) => {
    const actor = game.actors.get(id);
    if (!actor || !actor.isOwner) throw Error(`Choose an available actor for ${owner}.`);
    if (ids.has(id)) throw Error("Each actor can only be mapped to one owner.");
    ids.add(id);
    return {owner, actor};
  });
}
export function snapshot(mapping, sheetRows = [], baseRows = [], refs = {}) {
  const rows = [], links = new Map();
  const actors=mappedActors(mapping);
  const claimants=new Map();
  for(const {actor} of actors) for(const item of actor.items) {
    const id=readFlag(item).rowId;
    if(id) { if(!claimants.has(id)) claimants.set(id,[]); claimants.get(id).push({actor,item}); }
  }
  for (const {owner, actor} of actors) {
    const items = [...actor.items].filter(physical);
    for (const item of items) {
      const source = item.toObject(), s = source.system, f = readFlag(source);
      let id = f.rowId || `${actor.id}:${item.id}`;
      // Trade modules may copy flags when splitting a stack. Only one instance
      // keeps the old row ID; the new stack gets its own ID and quantity.
      if(f.rowId && claimants.get(f.rowId)?.length>1) {
        const candidates=claimants.get(f.rowId);
        const original=candidates.find(c=>refs[f.rowId] === `${c.actor.id}:${c.item.id}`)
          ?? candidates.find(c=>baseRows.find(b=>b.id===f.rowId)?.owner === actors.find(a=>a.actor.id===c.actor.id)?.owner)
          ?? candidates[0];
        if(original.item !== item) id=`${actor.id}:${item.id}`;
      }
      if (!f.rowId && !baseRows.some(r => r.id === id)) {
        const candidates = sheetRows.filter(r => r.kind === "item" && r.owner === owner && r.name === item.name && !baseRows.some(b=>b.id===r.id));
        if (candidates.length && (candidates.length !== 1 || items.filter(i => i.name === item.name).length !== 1)) {
          throw Error(`Ambiguous first match for ${owner} / ${item.name}. Give different items distinct names before first sync.`);
        }
        if (candidates.length === 1) id = candidates[0].id;
      }
      const uses = s.uses?.per ? s.uses.value : f.uses;
      const r = normalize({kind:"item", id, owner, name:item.name, quantity:s.quantity, uses,
        price:f.unknownPrice && s.price === 0 ? null : s.price, weight:f.unknownWeight && s.weight === 0 ? null : s.weight, sell:f.sell ?? false,
        storage:s.carried === false ? f.storage || "Bank" : "Carried", notes:f.notes ?? ""});
      rows.push(r); links.set(id, {actor, item});
    }
    const previous=[...baseRows,...sheetRows].filter(r=>r.kind === "wallet" && r.owner === owner);
    const carried=previous.find(r=>r.storage === "Carried");
    const carriedId=carried?.id ?? `${actor.id}:wallet:Carried`;
    rows.push(normalize({kind:"wallet",id:carriedId,owner,storage:"Carried",...actor.toObject().system.currency}));
    links.set(carriedId,{actor});
    const flags=actor.flags?.[ID] ?? {};
    for(const bank of Object.values(flags.wallets ?? {})) {
      rows.push(normalize({kind:"wallet",id:bank.id,owner,storage:bank.storage,...bank.coins}));
      links.set(bank.id,{actor});
    }
    if(flags.bank && !flags.bankMigrated) {
      const old=previous.find(r=>r.storage === "Bank");
      const id=old?.id ?? `${actor.id}:wallet:Bank`;
      rows.push(normalize({kind:"wallet",id,owner,storage:"Bank",...flags.bank}));
      links.set(id,{actor});
    }
  }
  indexRows(rows);
  return {rows, links};
}
export function validateApply(rows, mapping, links) {
  const owners = new Set(Object.keys(mapping));
  indexRows(rows);
  for (const r of rows) {
    if (!owners.has(r.owner)) throw Error(`Map an actor for ${r.owner} first.`);
    const link = links.get(r.id);
    if (link && link.actor.id !== mapping[r.owner]) throw Error(`${r.name || r.owner}: transfer items using Foundry's trade tools, then sync. Editing Owner in the sheet cannot transfer a linked item.`);
  }
}
export async function applyRows(rows, mapping, links) {
  assertGM(); validateApply(rows, mapping, links);
  for (const r of rows) {
    const actor = game.actors.get(mapping[r.owner]);
    if (r.kind === "wallet") {
      const coins = Object.fromEntries(["pp","gp","sp","cp"].map(k => [k, r[k]]));
      const current = r.storage === "Carried" ? actor.toObject().system.currency : actor.flags?.[ID]?.wallets?.[walletKey(r.id)]?.coins;
      if(r.storage !== "Carried") {
        const wallets={...actor.flags?.[ID]?.wallets,[walletKey(r.id)]:{id:r.id,storage:r.storage,coins}};
        await actor.update({[`flags.${ID}.wallets`]:wallets,[`flags.${ID}.bankMigrated`]:true,...(r.storage === "Bank"?{[`flags.${ID}.bank`]:coins}:{})});
        continue;
      }
      if (!same(coins, Object.fromEntries(["pp","gp","sp","cp"].map(k => [k, current?.[k] ?? 0])))) {
        await actor.update(r.storage === "Carried" ? Object.fromEntries(Object.entries(coins).map(([k,v]) => [`system.currency.${k}`,v])) : {[`flags.${ID}.bank`]:coins});
      }
      continue;
    }
    const item = links.get(r.id)?.item;
    const update = {
      name:r.name, "system.quantity":r.quantity, "system.carried":r.storage === "Carried",
      [`flags.${ID}.rowId`]:r.id, [`flags.${ID}.sell`]:r.sell, [`flags.${ID}.notes`]:r.notes,
      [`flags.${ID}.uses`]:r.uses
    };
    update[`flags.${ID}.storage`]=r.storage;
    for (const field of ["price", "weight"]) {
      if (r[field] !== null) update[`system.${field}`] = r[field];
      update[`flags.${ID}.unknown${field === "price"?"Price":"Weight"}`] = r[field] === null;
    }
    if (item?.toObject().system.uses?.per && r.uses !== null) update["system.uses.value"] = r.uses;
    if (item) {
      // Don't touch actions, descriptions, native containers or other mechanics.
      await actor.updateEmbeddedDocuments("Item", [{_id:item.id, ...update}]);
    } else {
      const system = {quantity:r.quantity, carried:r.storage === "Carried", price:r.price ?? 0, weight:r.weight ?? 0, identified:true};
      const created = await actor.createEmbeddedDocuments("Item", [{name:r.name, type:"loot", img:"icons/svg/item-bag.svg", system,
        flags:{[ID]:{rowId:r.id,sell:r.sell,notes:r.notes,uses:r.uses,storage:r.storage,unknownPrice:r.price === null,unknownWeight:r.weight === null}}}]);
      links.set(r.id, {actor, item:created[0]});
    }
  }
}
