import {ID, escapeHTML as e, numeric} from "./core.mjs";
import {assertGM, mappedActors} from "./foundry.mjs";

// GM distribution, intentionally independent of third-party trade modules.
export async function transferItem(source, target, itemId, quantity, expected, destination="Carried", privacy=null) {
  assertGM();
  if(source.id===target.id) throw Error("Choose two different actors.");
  if(!source.isOwner || !target.isOwner) throw Error("You need ownership of both actors.");
  const item=source.items.get(itemId);
  if(!item) throw Error("The source item was moved or removed. Open the transfer again.");
  const data=item.toObject(), available=Number(data.system.quantity);
  const before=JSON.stringify(data);
  quantity=numeric(quantity,"Transfer quantity",{blank:0});
  if(quantity<=0 || quantity>available) throw Error("Quantity must be greater than zero and no more than the available stack.");
  if(expected && JSON.stringify(data)!==expected) throw Error("This item changed while the transfer was open. Open it again.");
  if(!["weapon","equipment","consumable","loot","container"].includes(item.type)) throw Error("Only physical inventory items can be transferred.");
  const links=data.system.links;
  const hasLinks=links && Object.values(links).some(v=>Array.isArray(v)?v.length:!!v);
  if(item.inContainer || hasLinks || [...source.items].some(i=>i.toObject().system.containerId===itemId)) {
    throw Error("Unpack this item and remove linked contents first. Moving linked bags or ammunition relationships needs the native sheet.");
  }
  const full=quantity===available;
  const rowId=full ? data.flags?.[ID]?.rowId || `${source.id}:${item.id}` : crypto.randomUUID();
  const sourceRowId=data.flags?.[ID]?.rowId || `${source.id}:${item.id}`;
  delete data._id; delete data._stats;
  data.system.quantity=quantity;
  destination=String(destination).trim() || "Carried";
  if(destination.length>120 || /[\u0000-\u001f]/.test(destination)) throw Error("Use a location name of at most 120 characters.");
  data.system.carried=destination === "Carried";
  data.flags ??= {}; data.flags[ID]={...data.flags[ID],rowId,storage:destination};
  const f=data.flags[ID],legacy=['notes','gmNotes','trueName','actualValue','secretProperties'].some(k=>f[k]!=null&&f[k]!=='')?
    {id:sourceRowId,trueName:f.trueName??item.name,actualValue:f.actualValue??item.system.price,secretProperties:f.secretProperties??'',gmNotes:[f.notes,f.gmNotes].filter(Boolean).join('\n')}:null;
  if(legacy && !privacy)throw Error('Migrate legacy GM notes with Preview sync before transferring this item.');
  if(privacy)await privacy({sourceId:sourceRowId,targetId:rowId,legacy});
  for(const key of ['notes','gmNotes','trueName','actualValue','secretProperties'])delete data.flags[ID][key];
  const created=await target.createEmbeddedDocuments("Item",[data]);
  if(created.length!==1) throw Error("The recipient did not create the item. Source inventory was kept.");
  try {
    // Re-read after target creation, since another GM may have modified source.
    const now=source.items.get(itemId);
    if(!now || JSON.stringify(now.toObject())!==before) throw Error("Source changed during transfer.");
    if(full) await source.deleteEmbeddedDocuments("Item",[itemId]);
    else await source.updateEmbeddedDocuments("Item",[{_id:itemId,"system.quantity":available-quantity,...Object.fromEntries(['notes','gmNotes','trueName','actualValue','secretProperties'].map(k=>[`flags.${ID}.-=${k}`,null]))}]);
  } catch(err) {
    try {await target.deleteEmbeddedDocuments("Item",[created[0].id]);}
    catch {throw Error("Transfer failed and the recipient copy could not be removed. Check both inventories before retrying.");}
    throw err;
  }
  return created[0];
}

export function tradeDialog(exclusive, locations=['Carried','Bank'], privacy=null) {
  assertGM();
  const actors=mappedActors(game.settings.get(ID,"mapping"));
  if(actors.length<2) throw Error("Map at least two owners / actors before transferring loot.");
  const choices=actors.map(({owner,actor})=>`<option value="${e(actor.id)}">${e(owner)}</option>`).join("");
  new Dialog({title:"Distribute loot",content:`<div class="pf1-sync"><p>Choose the loot source and recipient. Individual items and partial stacks are supported.</p>
    <label>From<select name="source">${choices}</select></label><label>To<select name="target">${choices}</select></label></div>`,buttons:{
    next:{label:"Choose item",callback:html=>{
      try {
        const el=html instanceof HTMLElement?html:html[0];
        const source=game.actors.get(el.querySelector("[name=source]").value),target=game.actors.get(el.querySelector("[name=target]").value);
        if(source.id===target.id) throw Error("Choose two different actors.");
        const items=[...source.items].filter(i=>["weapon","equipment","consumable","loot","container"].includes(i.type) && i.system.quantity>0);
        if(!items.length) throw Error("The source has no inventory to transfer.");
        const originals=new Map(items.map(i=>[i.id,JSON.stringify(i.toObject())]));
        new Dialog({title:`${source.name} → ${target.name}`,content:`<div class="pf1-sync"><label>Item<select name="item">${items.map(i=>`<option value="${e(i.id)}">${e(i.name)} · available ${e(i.system.quantity)}</option>`).join("")}</select></label>
          <label>Quantity<input type="number" min="0.001" step="any" name="qty" value="1"></label><label>Recipient storage location<select name="destination">${locations.map(n=>`<option value="${e(n)}" ${n==='Carried'?'selected':''}>${e(n)}</option>`).join('')}</select></label><p>Existing stacks stay separate so charges, notes and magic properties are preserved. Sync afterwards to update the sheet.</p></div>`,buttons:{
          move:{label:"Transfer loot",callback:h=>exclusive(async()=>{
            const r=h instanceof HTMLElement?h:h[0],id=r.querySelector("[name=item]").value;
            await transferItem(source,target,id,r.querySelector("[name=qty]").value,originals.get(id),r.querySelector("[name=destination]").value,privacy);
            ui.notifications.info(`Loot transferred to ${target.name}. Preview sync to update the sheet.`);
          }).catch(err=>ui.notifications.error(err.message))},cancel:{label:"Cancel"}
        }},{width:560}).render(true);
      } catch(err) {ui.notifications.error(err.message);}
    }},cancel:{label:"Cancel"}
  }},{width:560}).render(true);
}
