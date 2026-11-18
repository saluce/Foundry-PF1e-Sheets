import {normalize} from './core.mjs';

export const REVEAL_FIELDS=['name','price','properties'];
export function publicRows(rows) { return rows.map(r=>{const out=normalize(r);if(r.kind==='wallet')for(const k of ['pp','gp','sp','cp'])if(r[k]===null)out[k]=null;return out;}); }
export function publicState(data) {
  if(data.schema!==3) throw Error('Version 0.3 requires the private standalone Google bridge and new player workbook.');
  return {schema:3,binding:String(data.binding),revision:String(data.revision),gmRevision:String(data.gmRevision),
    locations:[...data.locations],owners:[...(data.owners??[])],rows:publicRows(data.rows),lineages:(data.lineages??[]).map(r=>({sourceId:String(r.sourceId),targetId:String(r.targetId)})),unassignedCarriers:(data.unassignedCarriers??[]).map(String),inactiveOwners:(data.inactiveOwners??[]).map(String),characterHealth:(data.characterHealth??[]).map(h=>({owner:String(h.owner),version:Number(h.version),lifecycle:Number(h.lifecycle||1),value:h.value===null?null:Number(h.value),temp:Number(h.temp),max:h.max===null?null:Number(h.max)}))};
}
export function cleanGMRecord(raw,id) {
  const r={id:String(id),trueName:String(raw.trueName??''),actualValue:raw.actualValue===''||raw.actualValue==null?null:Number(raw.actualValue),
    secretProperties:String(raw.secretProperties??''),gmNotes:String(raw.gmNotes??'')};
  if(r.actualValue!==null && (!Number.isFinite(r.actualValue)||r.actualValue<0)) throw Error('Actual value must be a non-negative number.');
  return r;
}
export function revealedRow(row,record,fields) {
  if(!fields.length || fields.some(f=>!REVEAL_FIELDS.includes(f))) throw Error('Choose name, value or properties to reveal. GM notes cannot be revealed.');
  const out=normalize(row),gm=cleanGMRecord(record,row.id);
  if(fields.includes('name')) {if(!gm.trueName.trim())throw Error('Enter a true name before revealing it.');out.name=gm.trueName.trim();}
  if(fields.includes('price')) {if(gm.actualValue===null)throw Error('Enter an actual value before revealing it.');out.price=gm.actualValue;}
  if(fields.includes('properties'))out.properties=gm.secretProperties;
  return out;
}
export function migratedPrivate(record) {
  const r=normalize(record);
  return r.kind==='item'?cleanGMRecord({trueName:r.name,actualValue:r.price,gmNotes:r.notes},r.id):null;
}
