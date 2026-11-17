import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {ID,normalize,reconcile} from '../scripts/core.mjs';
import {publicState,revealedRow,migratedPrivate} from '../scripts/privacy.mjs';
import {snapshot,applyRows} from '../scripts/foundry.mjs';
import {transferItem} from '../scripts/trade.mjs';
import {lookupDialog} from '../scripts/lookup.mjs';

const SECRET='SECRET_GM_PLAN',TRUE_NAME='SECRET_TRUE_RING',PROPS='SECRET_CURSE_TEXT';
const pubItem=(extra={})=>normalize({kind:'item',id:'r1',owner:'Hero',name:'Unidentified ring',quantity:2,price:25,weight:1,notes:'Player note',...extra});
const gmRecord={id:'r1',owner:'Hero',trueName:TRUE_NAME,actualValue:9876.5,secretProperties:PROPS,gmNotes:SECRET};
const copy=x=>structuredClone(x);
class Sheet{
  constructor(name,id){this.name=name;this.id=id;this.grid=Array.from({length:260},()=>[]);this.filter=false;}
  getName(){return this.name;}getSheetId(){return this.id;}getMaxRows(){return this.grid.length;}
  getLastRow(){let n=this.grid.length;while(n&&this.grid[n-1].every(v=>v==null||v===''))n--;return n;}
  insertRowsAfter(_,n){this.grid.push(...Array.from({length:n},()=>[]));}
  getRange(row,col,nr=1,nc=1){if(typeof row==='string'){row=6;col=1;nr=250;nc=1;}const s=this;const range={
    getValues:()=>Array.from({length:nr},(_,r)=>Array.from({length:nc},(_,c)=>s.grid[row+r-1]?.[col+c-1]??'')),
    setValue(v){s.grid[row-1][col-1]=v;return range;},
    setValues(values){assert.equal(values.length,nr);for(let r=0;r<nr;r++){assert.equal(values[r].length,nc);for(let c=0;c<nc;c++){const v=values[r][c];s.grid[row+r-1][col+c-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v;}}return range;},
    setFormulas(){return range;},setDataValidation(){return range;},setBackground(){return range;},setFontColor(){return range;},setFontWeight(){return range;},createFilter(){s.filter=true;return range;}
  };return range;}
  getFilter(){return this.filter;}setFrozenRows(){}hideColumns(){}hideSheet(){}
  clearContents(){this.grid=Array.from({length:260},()=>[]);}
  getProtections(){return [];}protect(){return {setDescription(){},removeEditors(){},getEditors(){return [];},canDomainEdit(){return false;}};}
}
class Book{
  constructor(id){this.id=id;this.sheets=new Map();this.next=1;}
  insertSheet(n){const s=new Sheet(n,this.next++);this.sheets.set(n,s);return s;}
  getSheetByName(n){return this.sheets.get(n);}getId(){return this.id;}getUrl(){return 'https://docs.google.com/spreadsheets/d/'+this.id;}
}
function bridge(){
  const pub=new Book('public'),gm=new Book('private'),props=new Map([['PUBLIC_SPREADSHEET_ID','public'],['GM_SPREADSHEET_ID','private'],['TOKEN','secret'],['BINDING','binding']]);
  const access={permissions:[{type:'user',emailAddress:'gm@example.com',role:'owner'}],status:200};
  const context=vm.createContext({console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},
    Session:{getEffectiveUser:()=>({getEmail:()=> 'gm@example.com'})},ScriptApp:{getOAuthToken:()=> 'mock-token'},
    UrlFetchApp:{fetch:()=>({getResponseCode:()=>access.status,getContentText:()=>JSON.stringify({permissions:access.permissions})})},
    SpreadsheetApp:{openById:id=>{if(id==='private')return gm;if(id==='public')return pub;throw Error('Unavailable workbook');},flush(){},ProtectionType:{SHEET:1},newDataValidation:()=>({requireValueInRange(){return this;},setAllowInvalid(){return this;},build(){return {};}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:v=>Buffer.from(v).toString('base64url')},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},ContentService:{MimeType:{JSON:1},createTextOutput:s=>({setMimeType:()=>s})}
  });
  vm.runInContext(fs.readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8'),context);
  const header=n=>JSON.parse(JSON.stringify(vm.runInContext(n,context)));
  pub.insertSheet('Owners').getRange(5,1,3,2).setValues([['Owner','Tab'],['Hero','Hero'],['Party Loot','Party Loot']]);
  for(const owner of ['Hero','Party Loot'])pub.insertSheet(owner).getRange(6,1,1,12).setValues([header('ITEM_HEADERS')]);
  pub.getSheetByName('Hero').getRange(7,1,1,10).setValues([['r1','Unidentified ring',2,'','Carried','Player note',25,1,'',false]]);
  pub.insertSheet('Wallets').getRange(5,1,2,8).setValues([header('WALLET_HEADERS'),['wallet','Hero','Carried',0,2,0,0,'']]);
  pub.insertSheet('Banks');pub.insertSheet('Locations').getRange(5,1,3,1).setValues([['Location'],['Carried'],['Town Bank']]);
  gm.insertSheet('GMDetails').getRange(5,1,2,9).setValues([header('GM_HEADERS'),['r1','Hero',TRUE_NAME,9876.5,PROPS,SECRET,false,false,false]]);
  const call=body=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({token:'secret',world:'world',...body})}}));
  return {pub,gm,props,access,context,call,publicText:()=>JSON.stringify([...pub.sheets.values()].map(s=>s.grid))};
}

const daggerHTML='<h1>Dagger</h1><p><b>Cost</b> 2 gp <b>Weight</b> 1 lb.<br><b>Damage</b> 1d4</p>';
const pearlHTML='<h1>Pearl of Power</h1><p><b>Price</b> 1,000 gp (1st), 4,000 gp (2nd), 9,000 gp (3rd); <b>Weight</b> &mdash;</p><h2>CONSTRUCTION</h2><p><b>Cost</b> 500 gp</p>';
const daggerURL='https://www.d20pfsrd.com/equipment/weapons/weapon-descriptions/dagger/';
function lookupBridge(html=daggerHTML){const b=bridge();b.context.lookupFetch=()=>html;return b;}
function lookupRequest(b,extra={}){const s=b.call({action:'lookupRead',url:daggerURL,name:'Dagger'});assert.equal(s.ok,true);return {action:'lookupApply',id:'r1',revision:s.revision,gmRevision:s.gmRevision,url:daggerURL,name:s.lookup.query,signature:s.lookup.signature,priceIndex:0,weightIndex:0,visibility:'private',...extra};}

test('lookup reads live-page statblock shapes and separates pearl price variants from crafting cost',()=>{
  const b=lookupBridge(),d=b.call({action:'lookupRead',url:daggerURL,name:'Dagger'});assert.equal(d.ok,true);assert.equal(d.lookup.prices[0].value,2);assert.equal(d.lookup.weights[0].value,1);
  b.context.lookupFetch=()=>pearlHTML;const p=b.call({action:'lookupRead',url:daggerURL,name:'Pearl of Power'}).lookup;
  assert.deepEqual(p.prices.map(p=>p.value),[1000,4000,9000]);assert.equal(p.prices[1].label,'2nd');assert.equal(p.weights[0].value,0);
});
test('lookup parses table rows, fractions and coin units without choosing another item',()=>{
  const b=lookupBridge('<h1>Gear</h1><h2>Equipment</h2><table><tr><th>Item</th><th>Cost</th><th>Weight</th></tr><tr><td>Other item</td><td>99 gp</td><td>10 lbs.</td></tr><tr><td>Flask</td><td>3 cp</td><td>1/2 lb.</td></tr></table>');
  const r=b.call({action:'lookupRead',url:daggerURL,name:'Flask'}).lookup;assert.equal(r.title,'Flask');assert.equal(r.prices[0].value,0.03);assert.equal(r.weights[0].value,0.5);
});
test('unknown and composite prices stay blank instead of becoming zero or an arbitrary number',()=>{
  const b=lookupBridge('<h1>Custom item</h1><p><b>Price</b> 5 gp plus 20 gp per level <b>Weight</b> varies</p>');
  const r=b.call({action:'lookupRead',url:daggerURL,name:'Custom item'}).lookup;assert.deepEqual(r.prices,[]);assert.deepEqual(r.weights,[]);
  b.context.lookupFetch=()=>'<h1>Variable item</h1><p><b>Price</b> 5 gp/lb. <b>Weight</b> 1–5 lbs.</p>';
  const range=b.call({action:'lookupRead',url:daggerURL}).lookup;assert.deepEqual(range.prices,[]);assert.deepEqual(range.weights,[]);
  b.context.lookupFetch=()=>'<h1>Item without a listed price</h1><h2>CONSTRUCTION</h2><p><b>Cost</b> 500 gp</p>';
  assert.deepEqual(b.call({action:'lookupRead',url:daggerURL}).lookup.prices,[]);
});
test('a nonmatching equipment table cannot fall back to another item statblock',()=>{
  const b=lookupBridge('<h1>Equipment</h1><p><b>Cost</b> 999 gp <b>Weight</b> 99 lb.</p><table><tr><th>Item</th><th>Cost</th><th>Weight</th></tr><tr><td>Flask</td><td>3 cp</td><td>1/2 lb.</td></tr></table>');
  const r=b.call({action:'lookupRead',url:daggerURL,name:'Backpack'}).lookup;assert.deepEqual(r.prices,[]);assert.deepEqual(r.weights,[]);
});
test('lookup refuses external URLs, credentials and off-site redirects',()=>{
  const b=bridge();for(const url of ['http://www.d20pfsrd.com/a','https://www.d20pfsrd.com.evil.test/a','https://www.d20pfsrd.com@evil.test/a','https://evil.test/','https://www.d20pfsrd.com/\\evil'])assert.throws(()=>b.context.lookupURL(url));
  let requests=0;b.context.UrlFetchApp.fetch=()=>{requests++;return {getResponseCode:()=>302,getAllHeaders:()=>({Location:'https://evil.test/'})};};
  assert.throws(()=>b.context.lookupFetch(daggerURL),/HTTPS item URL/);assert.equal(requests,1);
});
test('lookup search ranks exact equipment names and excludes spell results',()=>{
  const b=bridge();b.context.lookupFetch=()=>'<h1>Search</h1><h2><a href="'+daggerURL+'">Dagger</a></h2><h2><a href="https://www.d20pfsrd.com/magic/spells/d/dagger/">Dagger spell</a></h2><a href="https://www.d20pfsrd.com/magic-items/3rd-party-items/falcon-dagger/">Falcon Dagger</a>';
  const r=b.call({action:'lookupSearch',query:'dagger'});assert.equal(r.ok,true);assert.equal(r.candidates[0].name,'Dagger');assert.equal(r.candidates.some(r=>r.url.includes('/spells/')),false);
});
test('private lookup price never reaches the public response or grid, while selected weight does',()=>{
  const b=lookupBridge(pearlHTML),req=lookupRequest(b,{priceIndex:2});const r=b.call(req);assert.equal(r.ok,true);assert.equal(r.rows[0].price,25);assert.equal(r.rows[0].weight,0);
  assert.equal(b.call({action:'gmRead',id:'r1'}).record.actualValue,9000);assert.equal(b.call({action:'gmRead',id:'r1'}).record.gmNotes,SECRET);
  assert.ok(!JSON.stringify(r).includes('9000'));assert.ok(!b.publicText().includes('9000'));assert.ok(b.gm.getSheetByName('_Lookups'));assert.ok(!b.pub.getSheetByName('_Lookups'));
});
test('public lookup only changes selected fields, preserves identity/notes and converts packs explicitly',()=>{
  const b=lookupBridge(),r=b.call(lookupRequest(b,{visibility:'public',packSize:10}));assert.equal(r.ok,true);const item=r.rows.find(r=>r.id==='r1');assert.equal(item.price,0.2);assert.equal(item.weight,0.1);assert.equal(item.name,'Unidentified ring');assert.equal(item.quantity,2);assert.equal(item.notes,'Player note');
  assert.equal(b.call({action:'gmRead',id:'r1'}).record.actualValue,0.2);
});
test('stale inventory, changed source, invalid selections and unauthenticated lookups cannot write',()=>{
  for(const change of [{revision:'stale'},{gmRevision:'stale'},{signature:'stale'},{priceIndex:100},{visibility:'everyone'},{packSize:0},{packSize:1.5},{token:'wrong'}]){const b=lookupBridge(),before=b.publicText(),r=b.call({...lookupRequest(b),...change});assert.equal(r.ok,false);assert.equal(b.publicText(),before);assert.equal(b.call({action:'gmRead',id:'r1'}).record.actualValue,9876.5);}
});
test('lookup rolls private and public values back when writing fails',()=>{
  const b=lookupBridge(),req=lookupRequest(b,{visibility:'public'}),before=b.call({action:'read'}).rows,write=b.context.writePublic;let first=true;b.context.writePublic=(...args)=>{if(first){first=false;throw Error('Write failed');}return write(...args);};assert.equal(b.call(req).ok,false);assert.deepEqual(b.call({action:'read'}).rows,before);assert.equal(b.call({action:'gmRead',id:'r1'}).record.actualValue,9876.5);
});
test('lookup interface requires confirmation and submits selected fields with the original revision',async()=>{
  const dialogs=[],calls=[],b=lookupBridge(),state=b.call({action:'read'});globalThis.ui={notifications:{info(){}}};
  const nodes={item:{value:'r1'},query:{value:'Dagger'},url:{value:daggerURL},price:{checked:true},weight:{checked:false},visibility:{value:'private'},priceChoice:{value:'0'},packSize:{value:'1'}};
  const root=()=>({querySelector:q=>nodes[q.match(/name=([^\]]+)/)[1]]});
  const open=lookupDialog({readSheet:async()=>state,request:async(action,args)=>{calls.push(action);return b.call({action,...args});},dialog:(title,html,buttons)=>dialogs.push({title,html,buttons}),root,exclusive:fn=>fn(),notifyError:err=>{throw err;}});
  await open();assert.equal(calls.length,0);await dialogs[0].buttons.search.callback({});assert.deepEqual(calls,['lookupRead']);assert.match(dialogs[1].html,/Private GM actual value \(safe default\)/);await dialogs[1].buttons.apply.callback({});assert.deepEqual(calls,['lookupRead','lookupApply']);assert.equal(b.call({action:'read'}).rows[0].price,25);
});
test('public normalization drops private keys and preserves unrecorded coin balances',()=>{
  const data=publicState({schema:3,rows:[{...pubItem(),...gmRecord},{kind:'wallet',id:'w',owner:'Hero',storage:'Carried',pp:null,gp:2,sp:0,cp:null}],locations:['Carried'],revision:'r',gmRevision:'g',binding:'b',record:gmRecord});
  assert.ok(!JSON.stringify(data).includes(SECRET));assert.ok(!JSON.stringify(data).includes(TRUE_NAME));assert.equal(data.rows[1].pp,null);
  assert.throws(()=>publicState({schema:2}),/private standalone/);
});

test('location setup preserves native tables without adding overlapping basic filters',()=>{
  const b=bridge();
  for(const name of ['Hero','Party Loot'])b.pub.getSheetByName(name).getFilter=()=>{throw Error('Native tables do not use basic filters');};
  const result=b.call({action:'locations',locations:['Carried','Town Bank','Vault']});
  assert.equal(result.ok,true);
  assert.ok(result.locations.includes('Vault'));
  assert.equal(b.pub.getSheetByName('Hero').filter,false);
  assert.equal(b.pub.getSheetByName('Hero').grid[6][0],'r1');
});
test('reveals are independent; private notes are never a revealable field',()=>{
  const name=revealedRow(pubItem(),gmRecord,['name']);assert.equal(name.name,TRUE_NAME);assert.equal(name.price,25);assert.equal(name.properties,'');
  assert.equal(revealedRow(pubItem(),{...gmRecord,actualValue:0},['price']).price,0);
  assert.throws(()=>revealedRow(pubItem(),gmRecord,['gmNotes']),/cannot be revealed/);
  assert.equal(migratedPrivate(pubItem({notes:SECRET})).gmNotes,SECRET);
});
test('bridge read responses, public grids and summaries contain no secret values',()=>{
  const b=bridge(),r=b.call({action:'read'});assert.equal(r.ok,true);assert.equal(r.schema,3);
  for(const secret of [SECRET,TRUE_NAME,PROPS]){assert.ok(!JSON.stringify(r).includes(secret));assert.ok(!b.publicText().includes(secret));}
  assert.equal(b.call({action:'gmRead',id:'r1'}).record.gmNotes,SECRET);
  assert.equal(b.call({action:'gmRead',id:'r1',token:'wrong'}).ok,false);
});
test('private access failures and broad sharing block even public sync',()=>{
  for(const permission of [{type:'anyone',role:'reader'},{type:'domain',role:'reader'},{type:'group',emailAddress:'players@example.com',role:'reader'},{type:'user',emailAddress:'player@example.com',role:'reader'}]){
    const b=bridge(),before=b.publicText();b.access.permissions.push(permission);const r=b.call({action:'read'});assert.equal(r.ok,false);assert.match(r.error,/unapproved sharing/);assert.equal(b.publicText(),before);
  }
  const b=bridge();b.access.status=403;assert.equal(b.call({action:'read'}).ok,false);
  b.access.status=200;b.props.set('GM_SPREADSHEET_ID','public');assert.equal(b.call({action:'read'}).ok,false);
});
test('explicit additional GM access is accepted, while group access remains rejected',()=>{
  const b=bridge();b.props.set('GM_ALLOWED_EMAILS','secondgm@example.com');b.access.permissions.push({type:'user',emailAddress:'secondgm@example.com',role:'writer'});
  assert.equal(b.call({action:'read'}).ok,true);b.access.permissions.push({type:'group',emailAddress:'secondgm@example.com',role:'reader'});assert.equal(b.call({action:'read'}).ok,false);
});
test('only selected fields reach the player sheet and recovery remains private',()=>{
  const b=bridge(),before=b.call({action:'read'}),result=b.call({action:'reveal',id:'r1',fields:['name'],revision:before.revision,gmRevision:before.gmRevision});
  assert.equal(result.ok,true);assert.equal(result.rows[0].name,TRUE_NAME);assert.equal(result.rows[0].price,25);assert.equal(result.rows[0].properties,'');assert.equal(result.rows[0].notes,'Player note');
  assert.ok(!b.publicText().includes(SECRET));assert.ok(!b.publicText().includes(PROPS));assert.ok(!b.pub.getSheetByName('_Recovery'));assert.ok(b.gm.getSheetByName('_Recovery'));
  assert.equal(b.call({action:'reveal',id:'r1',fields:['gmNotes'],revision:result.revision,gmRevision:result.gmRevision}).ok,false);
});
test('stale reveal requests fail, and player changes cannot overwrite GM truth',()=>{
  const b=bridge(),before=b.call({action:'read'});
  const save=b.call({action:'gmSave',id:'r1',gmRevision:before.gmRevision,record:{...gmRecord,gmNotes:'NEW_PRIVATE_SENTINEL'}});assert.equal(save.ok,true);
  assert.equal(b.call({action:'reveal',id:'r1',fields:['properties'],revision:before.revision,gmRevision:before.gmRevision}).ok,false);
  const edited=save.rows.map(r=>r.kind==='item'?{...r,name:'My nickname',price:3,notes:'Public edited note',trueName:'INJECTED'}:r);
  const committed=b.call({action:'commit',revision:save.revision,rows:edited});assert.equal(committed.ok,true);
  const gm=b.call({action:'gmRead',id:'r1'}).record;assert.equal(gm.trueName,TRUE_NAME);assert.equal(gm.actualValue,9876.5);assert.equal(gm.gmNotes,'NEW_PRIVATE_SENTINEL');
  assert.ok(!b.publicText().includes('NEW_PRIVATE_SENTINEL'));assert.ok(!JSON.stringify(committed).includes('INJECTED'));
});
test('legacy migration and stack cloning retain notes without publishing them',()=>{
  const b=bridge();let r=b.call({action:'migratePrivate',records:[{id:'legacy',owner:'Hero',trueName:'Public label',gmNotes:'OLD_PRIVATE_NOTE'}]});assert.equal(r.ok,true);
  r=b.call({action:'clonePrivate',sourceId:'legacy',targetId:'split'});assert.equal(r.ok,true);
  const rows=vm.runInContext("readPrivate(SpreadsheetApp.openById('private')).rows",b.context);
  assert.equal(rows.find(r=>r.id==='split').gmNotes,'OLD_PRIVATE_NOTE');assert.ok(!b.publicText().includes('OLD_PRIVATE_NOTE'));
  assert.equal(b.call({action:'clonePrivate',sourceId:'missing',targetId:'x'}).ok,false);
});
test('editing and sorting character rows retains IDs, owner routing and field values',()=>{
  const b=bridge(),r=b.call({action:'read'});const rows=[...r.rows,pubItem({id:'second',name:'Dagger',storage:'Town Bank'})];
  assert.equal(b.call({action:'commit',revision:r.revision,rows}).ok,true);
  const s=b.pub.getSheetByName('Hero');[s.grid[6],s.grid[7]]=[s.grid[7],s.grid[6]];s.grid[6][2]=7;
  const after=b.call({action:'read'});assert.equal(after.rows.find(r=>r.id==='second').quantity,7);assert.equal(after.rows.find(r=>r.id==='r1').name,'Unidentified ring');
  assert.ok(!b.publicText().includes(SECRET));
});

class Item{constructor(d){this.d=copy(d);this.id=d._id;}get flags(){return this.d.flags;}get name(){return this.d.name;}get type(){return this.d.type;}get system(){return this.d.system;}toObject(){return copy(this.d);}}
function patch(o,changes){for(const [path,v]of Object.entries(changes)){if(path==='_id')continue;const a=path.split('.');let t=o;for(const k of a.slice(0,-1))t=t[k]??={};if(a.at(-1).startsWith('-='))delete t[a.at(-1).slice(2)];else t[a.at(-1)]=copy(v);}}
class Actor{constructor(id,items=[]){this.id=id;this.isOwner=true;this.items=new Map(items.map(d=>[d._id,new Item(d)]));this.items[Symbol.iterator]=this.items.values.bind(this.items);this.d={system:{currency:{pp:0,gp:0,sp:0,cp:0}},flags:{}};this.count=0;}get flags(){return this.d.flags;}toObject(){return {...copy(this.d),items:[...this.items.values()].map(i=>i.toObject())};}async update(v){patch(this.d,v);}async updateEmbeddedDocuments(_,rows){for(const r of rows)patch(this.items.get(r._id).d,r);}async createEmbeddedDocuments(_,rows){return rows.map(r=>{const i=new Item({...r,_id:'new'+ ++this.count});this.items.set(i.id,i);return i;});}async deleteEmbeddedDocuments(_,ids){ids.forEach(id=>this.items.delete(id));}}
const native=()=>({_id:'i',name:'Unidentified ring',type:'loot',system:{quantity:2,price:25,weight:1,carried:true},flags:{[ID]:{rowId:'r1',notes:SECRET,gmNotes:'ALSO_PRIVATE'}}});
function world(actors){globalThis.game={user:{isGM:true},system:{id:'pf1'},version:'13.351',actors:new Map(actors.map(a=>[a.id,a]))};}
test('Foundry legacy notes are private migration inputs and removed only after confirmation',async()=>{
  const actor=new Actor('a',[native()]);world([actor]);const s=snapshot({Hero:'a'});assert.equal(s.rows.find(r=>r.id==='r1').notes,'');assert.match(s.legacyNotes[0].gmNotes,/SECRET_GM_PLAN/);
  await assert.rejects(applyRows(s.rows,{Hero:'a'},s.links),/private GM workbook/);
  await applyRows(s.rows,{Hero:'a'},s.links,{privateReady:true});assert.ok(!JSON.stringify(actor.toObject()).includes(SECRET));assert.ok(!JSON.stringify(actor.toObject()).includes('ALSO_PRIVATE'));
});
test('failed private clone blocks transfer before creating a recipient item',async()=>{
  const source=new Actor('a',[native()]),target=new Actor('b');world([source,target]);
  await assert.rejects(transferItem(source,target,'i',1,null,'Carried',async()=>{throw Error('Private service unavailable');}),/unavailable/);
  assert.equal(source.items.get('i').system.quantity,2);assert.equal(target.items.size,0);
});
test('partial transfers copy private links, never private payloads onto either actor',async()=>{
  const source=new Actor('a',[native()]),target=new Actor('b');world([source,target]);let link;
  const moved=await transferItem(source,target,'i',1,null,'Carried',async data=>{link=data;});
  assert.equal(link.sourceId,'r1');assert.notEqual(link.targetId,'r1');assert.match(link.legacy.gmNotes,/SECRET_GM_PLAN/);
  assert.ok(!JSON.stringify(moved.toObject()).includes(SECRET));assert.ok(!JSON.stringify(source.toObject()).includes(SECRET));
  assert.equal(source.items.get('i').system.quantity,1);
});
