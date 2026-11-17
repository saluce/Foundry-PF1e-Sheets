import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {ID,normalize,indexRows,reconcile,resolvePlan,parseCSV,convertLegacy,ITEM_HEADERS,WALLET_HEADERS} from '../scripts/core.mjs';
import {snapshot,applyRows,validateApply} from '../scripts/foundry.mjs';
import {transferItem} from '../scripts/trade.mjs';

const item=(overrides={})=>normalize({kind:'item',id:'r1',owner:'Party Loot',name:'Wand',quantity:2,uses:28,price:100,weight:1,sell:false,storage:'Carried',notes:'Keep its magic',...overrides});
const wallet=(overrides={})=>normalize({kind:'wallet',id:'coins',owner:'ExampleHero',storage:'Carried',gp:12,...overrides});
const copy=x=>structuredClone(x);
class FakeItem {
  constructor(data) {this.data=copy(data);this.id=data._id;}
  get name(){return this.data.name;} get type(){return this.data.type;}
  get system(){return this.data.system;} get flags(){return this.data.flags;}
  toObject(){return copy(this.data);}
}
function patch(obj,changes) {
  for(const [path,value] of Object.entries(changes)) {
    if(path==='_id') continue;
    const keys=path.split('.');let t=obj;
    for(const k of keys.slice(0,-1)) t=t[k]??={};if(keys.at(-1).startsWith('-='))delete t[keys.at(-1).slice(2)];else t[keys.at(-1)]=copy(value);
  }
}
class FakeActor {
  constructor(id,items=[]) {this.id=id;this.name=id;this.isOwner=true;this.items=new Map(items.map(d=>[d._id,new FakeItem(d)]));this.data={system:{currency:{pp:0,gp:0,sp:0,cp:0}},flags:{}};this.count=0;}
  get flags(){return this.data.flags;}
  toObject(){return {...copy(this.data),_id:this.id,items:[...this.items.values()].map(i=>i.toObject())};}
  async update(changes){patch(this.data,changes);}
  async updateEmbeddedDocuments(_,updates){for(const u of updates) patch(this.items.get(u._id).data,u);return updates;}
  async createEmbeddedDocuments(_,rows){return rows.map(r=>{const d={...copy(r),_id:`new${++this.count}`};const i=new FakeItem(d);this.items.set(d._id,i);return i;});}
  async deleteEmbeddedDocuments(_,ids){if(this.failDelete) throw Error('Simulated source failure');ids.forEach(id=>this.items.delete(id));}
}
function world(actors) {
  // Foundry Collections iterate documents, not Map entries.
  for(const a of actors) a.items[Symbol.iterator]=a.items.values.bind(a.items);
  globalThis.game={user:{isGM:true},system:{id:'pf1'},version:'13.351',actors:new Map(actors.map(a=>[a.id,a]))};
}
function native(overrides={}) {return {_id:'w1',name:'Wand',type:'consumable',system:{quantity:2,price:100,weight:1,carried:true,uses:{per:'charges',value:28,max:50},actions:[{name:'Shock',formula:'1d6'}]},flags:{[ID]:{rowId:'r1',publicNotes:'Keep its magic',sell:false}},...overrides};}

test('website full transfers preserve native PF1 rules while the Sheets path still rejects owner edits',async()=>{
  const a=new FakeActor('a',[native()]),b=new FakeActor('b');world([a,b]);const mapping={'Party Loot':'a',ExampleHero:'b'},local=snapshot(mapping),row=item({owner:'ExampleHero'});
  assert.throws(()=>validateApply([row],mapping,local.links),/transfer items/);
  await applyRows([row],mapping,local.links,{privateReady:true,allowTransfers:true});assert.equal(a.items.size,0);const moved=[...b.items.values()][0];assert.equal(moved.type,'consumable');assert.equal(moved.system.uses.value,28);assert.equal(moved.system.actions[0].formula,'1d6');assert.equal(moved.flags[ID].rowId,'r1');
});
test('website partial and chained transfers clone the native ancestor instead of becoming basic loot',async()=>{
  const sword=native({name:'Sword',type:'weapon',system:{quantity:4,price:50,weight:2,carried:true,actions:[{name:'Attack',formula:'1d8'}]}}),a=new FakeActor('a',[sword]),b=new FakeActor('b'),c=new FakeActor('c');world([a,b,c]);const mapping={'Party Loot':'a',ExampleHero:'b',Other:'c'},local=snapshot(mapping);
  const row=(id,owner,quantity)=>item({id,owner,quantity,name:'Sword',uses:null,price:50,weight:2});
  await applyRows([row('r1','Party Loot',1),row('r2','ExampleHero',1),row('r3','Other',2)],mapping,local.links,{privateReady:true,allowTransfers:true,lineages:[{sourceId:'r1',targetId:'r2'},{sourceId:'r2',targetId:'r3'}]});
  assert.equal(a.items.get('w1').system.quantity,1);assert.equal([...b.items.values()][0].type,'weapon');assert.equal([...c.items.values()][0].system.actions[0].formula,'1d8');assert.equal([...c.items.values()][0].system.quantity,2);
});
test('website transfer failures roll back recipient copies and preserve source inventories',async()=>{
  const a=new FakeActor('a',[native()]),b=new FakeActor('b');a.failDelete=true;world([a,b]);const mapping={'Party Loot':'a',ExampleHero:'b'},local=snapshot(mapping);
  await assert.rejects(()=>applyRows([item({owner:'ExampleHero'})],mapping,local.links,{privateReady:true,allowTransfers:true}),/Simulated source failure/);assert.equal(a.items.get('w1').system.quantity,2);assert.equal(b.items.size,0);assert.equal(local.links.get('r1').actor.id,'a');
});
test('website ancestry refuses missing native sources and packed containers before any mutation',async()=>{
  const a=new FakeActor('a',[native()]),b=new FakeActor('b');world([a,b]);const mapping={'Party Loot':'a',ExampleHero:'b'},local=snapshot(mapping);
  await assert.rejects(()=>applyRows([item({id:'new',owner:'ExampleHero'})],mapping,local.links,{privateReady:true,allowTransfers:true,nativeSourceIds:['gone'],lineages:[{sourceId:'gone',targetId:'new'}]}),/source is missing/);
  a.items.get('w1').inContainer=true;await assert.rejects(()=>applyRows([item({owner:'ExampleHero'})],mapping,local.links,{privateReady:true,allowTransfers:true}),/Unpack/);assert.equal(a.items.size,1);assert.equal(b.items.size,0);
});

test('independent field edits merge both ways',()=>{
  const b=item(),l=item({quantity:1}),r=item({notes:'Sell later'});
  const p=reconcile([b],[l],[r]);
  assert.equal(p.conflicts.length,0);
  assert.equal(p.rows[0].quantity,1);assert.equal(p.rows[0].notes,'Sell later');
  assert.deepEqual(new Set(p.changes.map(c=>c.target)),new Set(['Sheet','Foundry']));
});
test('same-field edits and first pairing require explicit decisions',()=>{
  const p=reconcile([item()],[item({quantity:1})],[item({quantity:3})]);
  assert.throws(()=>resolvePlan(p,[]),/Choose/);
  assert.equal(resolvePlan(p,['sheet'])[0].quantity,3);
  assert.equal(reconcile([],[item({quantity:1})],[item({quantity:3})]).conflicts.length,1);
});
test('sheet deletions restore a row; Foundry removals remove an unchanged sheet row',()=>{
  assert.equal(reconcile([item()],[item()],[]).rows.length,1);
  const removed=reconcile([item()],[],[item()]);
  assert.equal(removed.rows.length,0);assert.match(removed.changes[0].value,/Remove/);
  const conflict=reconcile([item()],[],[item({notes:'Changed after transfer'})]);
  assert.equal(resolvePlan(conflict,['foundry']).length,0);
  assert.equal(resolvePlan(conflict,['sheet']).length,1);
});
test('validate numbers, duplicate IDs and duplicate wallets without dropping zeros',()=>{
  assert.equal(item({quantity:0,uses:0,price:0}).uses,0);
  for(const v of [-1,'abc',Infinity,true,'0x10']) assert.throws(()=>item({quantity:v}));
  assert.throws(()=>item({uses:1.5}));
  assert.throws(()=>indexRows([item(),item()]));
  assert.throws(()=>indexRows([wallet(),wallet({id:'other'})]),/Duplicate wallet/);
});
test('legacy CSV handles commas, quoted notes, bank items and carried coins',()=>{
  const csv='ExampleHero\r\nItem,Qty,Use,Value,Weight,Sell,,,,,,,BANK,Qty\r\n"Wand, shocking",1,28,1000,0,x,,Gold,167,,,,Gem,2\r\nBolts,12,,2,2,,,Silver,724\r\n,,,,,,,Copper,1\r\n,,,,,,,Platinum,6\r\n';
  let id=0;const rows=convertLegacy(csv,'ExampleHero',()=>String(++id));
  assert.equal(rows.length,4);assert.equal(rows[0].name,'Wand, shocking');assert.equal(rows[0].sell,true);
  assert.equal(rows.find(r=>r.name==='Gem').storage,'Bank');
  assert.equal(rows.find(r=>r.kind==='wallet').gp,167);
  assert.deepEqual(parseCSV('"a\nb","c""d"'),[['a\nb','c"d']]);
  assert.throws(()=>parseCSV('"unclosed'),/Unclosed/);
  const blankQty=convertLegacy('Item,Qty\nMonkey head,\n','ExampleHero',()=> 'id');
  assert.equal(blankQty[0].quantity,1);assert.match(blankQty[0].notes,/Please check/);
  const stacks=convertLegacy('Item,Qty,Use,Value,Weight\nBolts,12,,24,6\n','ExampleHero',()=> 'id',{stackValues:true,stackWeights:true});
  assert.equal(stacks[0].price,2);assert.equal(stacks[0].weight,.5);
});
test('full transfer preserves rules and row identity, then syncs owner without resurrection',async()=>{
  const loot=new FakeActor('loot',[native()]),pc=new FakeActor('pc');world([loot,pc]);
  const mapping={'Party Loot':'loot',ExampleHero:'pc'},base=snapshot(mapping).rows;
  const moved=await transferItem(loot,pc,'w1',2);
  assert.equal(loot.items.size,0);assert.deepEqual(moved.system.actions,[{name:'Shock',formula:'1d6'}]);
  const after=snapshot(mapping,base,base).rows,plan=reconcile(base,after,base);
  assert.equal(plan.rows.filter(r=>r.kind==='item').length,1);
  assert.equal(plan.rows.find(r=>r.id==='r1').owner,'ExampleHero');
  assert.equal(plan.conflicts.length,0);
});
test('partial transfer keeps separate quantities and charges, with distinct IDs',async()=>{
  const loot=new FakeActor('loot',[native()]),pc=new FakeActor('pc');world([loot,pc]);
  const moved=await transferItem(loot,pc,'w1',1);
  assert.equal(loot.items.get('w1').system.quantity,1);assert.equal(moved.system.quantity,1);
  assert.notEqual(moved.flags[ID].rowId,'r1');assert.equal(moved.system.uses.value,28);
  const rows=snapshot({'Party Loot':'loot',ExampleHero:'pc'}).rows.filter(r=>r.kind==='item');
  assert.equal(rows.reduce((n,r)=>n+r.quantity,0),2);
});
test('split from external trade module copying flags gets a new ID',()=>{
  const loot=new FakeActor('loot',[native()]),pc=new FakeActor('pc',[native({_id:'copy'})]);world([loot,pc]);
  const state=snapshot({'Party Loot':'loot',ExampleHero:'pc'},[],[item()],{r1:'loot:w1'});
  const items=state.rows.filter(r=>r.kind==='item');assert.equal(new Set(items.map(r=>r.id)).size,2);
  assert.equal(items.find(r=>r.owner==='Party Loot').id,'r1');
});
test('transfer failure rolls recipient back; stale previews and linked bags are blocked',async()=>{
  const loot=new FakeActor('loot',[native()]),pc=new FakeActor('pc');world([loot,pc]);
  loot.failDelete=true;
  await assert.rejects(transferItem(loot,pc,'w1',2),/Simulated/);
  assert.equal(pc.items.size,0);assert.equal(loot.items.size,1);
  await assert.rejects(transferItem(loot,pc,'w1',1,'stale'),/changed/);
  loot.items.get('w1').data.system.links={children:['child']};
  await assert.rejects(transferItem(loot,pc,'w1',1),/Unpack/);
});
test('apply changes only inventory inputs and keeps bank money separate',async()=>{
  const loot=new FakeActor('loot',[native()]);world([loot]);
  const mapping={'Party Loot':'loot'},state=snapshot(mapping);
  const rows=[item({quantity:0,uses:0,storage:'Bank',notes:'Spent'}),wallet({id:'bank',owner:'Party Loot',storage:'Bank',gp:167})];
  await applyRows(rows,mapping,state.links);
  const s=loot.items.get('w1').system;
  assert.equal(s.quantity,0);assert.equal(s.uses.value,0);assert.equal(s.carried,false);
  assert.deepEqual(s.actions,[{name:'Shock',formula:'1d6'}]);
  assert.equal(loot.flags[ID].bank.gp,167);assert.equal(loot.data.system.currency.gp,0);
});
test('repeated sync is idempotent, and permission checks block writes',async()=>{
  const loot=new FakeActor('loot',[native()]);world([loot]);
  const mapping={'Party Loot':'loot'},state=snapshot(mapping);
  await applyRows(state.rows,mapping,state.links);
  const after=snapshot(mapping,state.rows,state.rows).rows;
  const plan=reconcile(after,after,after);assert.equal(plan.changes.length,0);assert.equal(plan.conflicts.length,0);
  game.user.isGM=false;await assert.rejects(applyRows(after,mapping,state.links),/GM/);
});
test('new unknown prices / weights remain blank on the sheet after a round trip',async()=>{
  const actor=new FakeActor('pc');world([actor]);const mapping={ExampleHero:'pc'};
  const row=item({id:'unknown',owner:'ExampleHero',price:null,weight:null});
  const before=snapshot(mapping);
  await applyRows([row],mapping,before.links);
  const result=snapshot(mapping,[row],[row]).rows.find(r=>r.id==='unknown');
  assert.equal(result.price,null);assert.equal(result.weight,null);
});

// Small in-memory Apps Script adapter verifies the actual deployed bridge source.
class Sheet {
  constructor(name,headers){this.name=name;this.cells=Array.from({length:205},()=>[]);if(headers)this.cells[4]=[...headers];}
  getName(){return this.name;} getMaxRows(){return this.cells.length;}
  getLastRow(){let n=this.cells.length;while(n && this.cells[n-1].every(v=>v===''||v==null))n--;return n;}
  insertRowsAfter(_,n){this.cells.push(...Array.from({length:n},()=>[]));}
  getRange(row,col,nr=1,nc=1){if(typeof row==='string'){row=6;col=1;nr=200;nc=1;}const s=this;return {
    getValues:()=>Array.from({length:nr},(_,r)=>Array.from({length:nc},(_,c)=>s.cells[row+r-1]?.[col+c-1]??'')),
    setValue:v=>{s.cells[row-1][col-1]=v;},
    setValues:values=>{assert.equal(values.length,nr);for(let r=0;r<nr;r++){assert.equal(values[r].length,nc);for(let c=0;c<nc;c++){const v=values[r][c];s.cells[row+r-1][col+c-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;}}},
    setFormulas:()=>{},setDataValidation:()=>{}
  };}
  clearContents(){this.cells=Array.from({length:205},()=>[]);} hideSheet(){}
}
function bridge() {
  const sheets=new Map([['Inventory',new Sheet('Inventory',ITEM_HEADERS)],['Loot',new Sheet('Loot',ITEM_HEADERS)],['Wallets',new Sheet('Wallets',WALLET_HEADERS)]]);
  const ss={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=new Sheet(n);sheets.set(n,s);return s;}};
  const props=new Map([['TOKEN','secret'],['SPREADSHEET_ID','sheet'],['BINDING','binding'],['LOOT_OWNERS','Party Loot']]);
  const ctx=vm.createContext({console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},
    SpreadsheetApp:{openById:()=>ss,flush:()=>{},newDataValidation:()=>({requireValueInRange(){return this;},setAllowInvalid(){return this;},build(){return {};}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    ContentService:{MimeType:{JSON:1},createTextOutput:t=>({setMimeType:()=>t})}
  });
  vm.runInContext(fs.readFileSync(new URL('./fixtures/legacy-bridge.txt',import.meta.url),'utf8'),ctx);
  return {ctx,sheets,call:payload=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({token:'secret',world:'world',...payload})}}))};
}
test('bridge authenticates, assigns IDs, detects edits and routes party loot separately',()=>{
  const b=bridge();
  assert.equal(b.call({action:'read',token:'wrong'}).ok,false);
  const initial=b.call({action:'read'});assert.equal(initial.ok,true);
  const committed=b.call({action:'commit',revision:initial.revision,rows:[item(),wallet()]});assert.equal(committed.ok,true);
  assert.equal(b.sheets.get('Loot').cells[5][2],'Wand');
  assert.equal(b.sheets.get('Inventory').cells[5]?.[2]??'','');
  b.sheets.get('Loot').cells[5][3]=5;
  assert.equal(b.call({action:'commit',revision:committed.revision,rows:[item(),wallet()]}).ok,false);
  assert.equal(b.call({action:'read',world:'another-world'}).ok,false);
  b.sheets.get('Inventory').cells[5]=['','ExampleHero','Gem',1,'',10,0,false,'Carried',''];
  const read=b.call({action:'read'});assert.equal(read.ok,true);
  assert.ok(read.rows.find(r=>r.name==='Gem').id);
  assert.equal(b.call({action:'read'}).revision,read.revision);
});
test('bridge rejects invalid rows and formula-looking text is written as literal text',()=>{
  const b=bridge(),initial=b.call({action:'read'});
  assert.equal(b.call({action:'commit',revision:initial.revision,rows:[item(),item()]}).ok,false);
  const x=item({name:'=IMPORTXML("secret")',notes:'@danger'});
  assert.equal(b.call({action:'commit',revision:initial.revision,rows:[x]}).ok,true);
  assert.equal(b.call({action:'read'}).rows[0].name,x.name);
  assert.equal(vm.runInContext('literal("=1+1")',b.ctx),"'=1+1");
});
test('named banks retain independent wallets and item locations across syncs',async()=>{
  const actor=new FakeActor('pc');world([actor]);const mapping={ExampleHero:'pc'};
  const rows=[item({owner:'ExampleHero',storage:'Town Bank'}),wallet({id:'wati',storage:'Town Bank',gp:154}),wallet({id:'other',storage:'Magnimar Bank',gp:22})];
  await applyRows(rows,mapping,new Map());
  let actual=snapshot(mapping,rows,rows).rows;
  assert.equal(actual.find(r=>r.id==='wati').gp,154);
  assert.equal(actual.find(r=>r.id==='other').gp,22);
  assert.equal(actual.find(r=>r.id==='r1').storage,'Town Bank');
  assert.equal(actor.data.system.currency.gp,0);
  const renamed=actual.map(r=>r.id==='wati'?{...r,storage:'Wati Treasury'}:r);
  await applyRows(renamed,mapping,snapshot(mapping,rows,rows).links);
  actual=snapshot(mapping,renamed,renamed).rows;
  assert.equal(actual.find(r=>r.id==='wati').storage,'Wati Treasury');
  assert.equal(actual.filter(r=>r.kind==='wallet'&&r.storage!=='Carried').length,2);
});
test('withdrawing a bank item makes it carried for the recipient',async()=>{
  const data=native();data.system.carried=false;data.flags[ID].storage='Town Bank';
  const bank=new FakeActor('bank',[data]),pc=new FakeActor('pc');world([bank,pc]);
  const moved=await transferItem(bank,pc,'w1',1);
  assert.equal(moved.system.carried,true);assert.equal(moved.flags[ID].storage,'Carried');
  assert.equal(bank.items.get('w1').flags[ID].storage,'Town Bank');
});
test('legacy bank balances upgrade without mixing with a new named wallet',async()=>{
  const actor=new FakeActor('pc');actor.data.flags[ID]={bank:{pp:0,gp:9,sp:0,cp:0}};world([actor]);
  const mapping={ExampleHero:'pc'},before=snapshot(mapping);
  const rows=[...before.rows,wallet({id:'new',storage:'Town Bank',gp:154})];
  await applyRows(rows,mapping,before.links);
  const after=snapshot(mapping,rows,rows).rows.filter(r=>r.kind==='wallet');
  assert.equal(after.find(r=>r.storage==='Bank').gp,9);
  assert.equal(after.find(r=>r.storage==='Town Bank').gp,154);
  assert.equal(after.length,3);
});
test('GM location registry allows new banks, blocks occupied removal and unknown locations',()=>{
  const b=bridge();
  let result=b.call({action:'locations',locations:['Carried','Town Bank','Magnimar Bank']});assert.equal(result.ok,true);
  assert.deepEqual(result.locations,['Carried','Town Bank','Magnimar Bank']);
  result=b.call({action:'commit',revision:result.revision,rows:[item({storage:'Town Bank'}),wallet({storage:'Town Bank'})]});assert.equal(result.ok,true);
  assert.equal(b.call({action:'locations',locations:['Carried','Magnimar Bank']}).ok,false);
  assert.equal(b.call({action:'locations',token:'wrong',locations:['Carried']}).ok,false);
  assert.equal(b.call({action:'commit',revision:result.revision,rows:[item({storage:'Unregistered stash'})]}).ok,false);
});
