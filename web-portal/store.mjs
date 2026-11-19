import {installCampaign,installCalendar} from './campaign.mjs';
import {installPlay} from './play.mjs';
import {installCommunity} from './community.mjs';
import {installHub} from './hub.mjs';
import {gameDatabase} from './games.mjs';
import {installCharacters} from './characters.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdirSync,chmodSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import {normalize} from '../scripts/core.mjs';
import {cleanGMRecord} from '../scripts/privacy.mjs';
import {installFeatures} from './features.mjs';

export class Problem extends Error {constructor(message,status=400){super(message);this.status=status;}}
export const fail=(message,status=400)=>{throw new Problem(message,status);};
export const hash=s=>createHash('sha256').update(String(s)).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export const text=(v,max=200)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail('Enter valid text.');return v.trim();};
export function passwordHash(password){if(typeof password!=='string'||password.length<12||password.length>256)fail('Use a password of 12–256 characters.');const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function passwordOK(password,stored){if(typeof password!=='string'||password.length>256)return false;const [salt,expected]=stored.split(':');return timingSafeEqual(scryptSync(password,salt,64),Buffer.from(expected,'hex'));}
const cleanPrivate=r=>({...cleanGMRecord(r,r.id),owner:text(r.owner||'',120),nameRevealed:r.nameRevealed===true,valueRevealed:r.valueRevealed===true,propertiesRevealed:r.propertiesRevealed===true});
export function cleanRow(raw){const row=normalize(raw);if(row.kind==='wallet')for(const k of ['pp','gp','sp','cp'])if(raw[k]===null)row[k]=null;for(const k of ['name','owner','storage','id'])if(row[k])text(row[k],k==='name'?250:256);if(row.notes?.length>10000||row.properties?.length>10000)fail('Notes or properties are too long.');return row;}

export class Ledger {
  constructor(file,{gameId='default',raw=null}={}){
    if(file!==':memory:'){mkdirSync(path.dirname(file),{recursive:true,mode:0o700});}
    this.file=file;this.gameId=gameId;this.ownsDatabase=!raw;this.rawDB=raw||new DatabaseSync(file);this.db=gameDatabase(this.rawDB,gameId);this.db.context.ledgers.set(gameId,this);if(file!==':memory:')try{chmodSync(file,0o600);}catch{}
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owners(name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS locations(name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS rows(id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS private_rows(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lineages(target_id TEXT PRIMARY KEY,source_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS grants(user_id TEXT NOT NULL REFERENCES users(id),owner TEXT NOT NULL REFERENCES owners(name),PRIMARY KEY(user_id,owner));
      CREATE TABLE IF NOT EXISTS invites(token TEXT PRIMARY KEY,owners TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,body TEXT NOT NULL);`);
    for(const [k,v]of Object.entries({binding:randomUUID(),world:'',revision:'0',gmRevision:'0',title:'Party Ledger',bridgeHash:'',origins:'[]'}))this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run(k,v);
    this.db.prepare('INSERT OR IGNORE INTO locations VALUES (?)').run('Carried');
    this.initFeatures();this.initCharacters();
  }
  get(k){return this.db.prepare('SELECT value FROM meta WHERE key=?').get(k)?.value;}
  set(k,v){this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?,?)').run(k,String(v));if(k==='title')this.rawDB.prepare('UPDATE games SET name=? WHERE id=?').run(String(v),this.gameId);}
  bump(gm=false){const k=gm?'gmRevision':'revision';this.set(k,Number(this.get(k))+1);}
  transaction(fn){if(this.db.context.transaction)return fn();this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;this.db.context.transaction=true;try{const r=fn();this.db.exec('COMMIT');return r;}catch(err){this.db.exec('ROLLBACK');throw err;}finally{this.inTransaction=false;this.db.context.transaction=false;}}
  audit(actor,action,body){this.db.prepare('INSERT INTO audit(at,actor,action,body) VALUES (?,?,?,?)').run(new Date().toISOString(),actor,action,JSON.stringify(body));}
  rows(){return this.db.prepare('SELECT body,version FROM rows ORDER BY rowid').all().map(r=>({...JSON.parse(r.body),version:r.version}));}
  row(id){const r=this.db.prepare('SELECT body,version FROM rows WHERE id=?').get(id);if(!r)fail('Item no longer exists.',404);return {...JSON.parse(r.body),version:r.version};}
  putRow(raw){const row=cleanRow(raw);this.db.prepare('INSERT INTO rows(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,version=version+1').run(row.id,JSON.stringify(row));return row;}
  privateRow(id){const r=this.db.prepare('SELECT body FROM private_rows WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
  putPrivate(r){const next=cleanPrivate(r);this.db.prepare('INSERT OR REPLACE INTO private_rows VALUES (?,?)').run(next.id,JSON.stringify(next));return next;}
  owners(){return this.db.prepare('SELECT name FROM owners ORDER BY rowid').all().map(r=>r.name);}
  locations(){return this.db.prepare('SELECT name FROM locations ORDER BY rowid').all().map(r=>r.name);}
  grantOwners(user){return user.role==='gm'?this.owners():this.db.prepare('SELECT owner FROM grants WHERE user_id=?').all(user.id).map(r=>r.owner);}
  canEdit(user,row){return user.role==='gm'||this.grantOwners(user).includes(row.owner);}
  gm(user){if(user.role!=='gm')fail('GM access required.',403);}
  publicUser(user){return {id:user.id,username:user.username,role:user.role,owners:this.grantOwners(user)};}
  checkVersion(row,version){if(row.version!==version)fail('This item changed. Refresh and review it again.',409);}
  revision(){return hash(this.get('revision')+':'+this.get('gmRevision'));}
  bridgeState(){return {schema:3,binding:this.get('binding'),revision:this.revision(),gmRevision:this.get('gmRevision'),owners:this.owners(),locations:this.locations(),rows:this.rows().map(({version,...r})=>r),lineages:this.db.prepare('SELECT source_id AS sourceId,target_id AS targetId FROM lineages').all().map(({sourceId,targetId})=>({sourceId,targetId}))};}
  publicState(user){
    const rows=this.rows(),canSee=t=>user.role==='gm'||t.createdBy===user.id||this.grantOwners(user).includes(t.recipient);
    const state={title:this.get('title'),user:this.publicUser(user),revision:this.get('revision'),owners:this.owners(),locations:this.locations(),rows,trades:this.db.prepare('SELECT body FROM trades').all().map(r=>JSON.parse(r.body)).filter(canSee)};
    if(user.role==='gm'){state.privateRecords=rows.filter(r=>r.kind==='item').map(r=>{const p=this.privateRow(r.id)||cleanPrivate({id:r.id,owner:r.owner,trueName:r.name,actualValue:null});return {...p,playerValue:r.price,difference:p.actualValue===null||r.price===null?null:p.actualValue-r.price,stackDifference:p.actualValue===null||r.price===null?null:(p.actualValue-r.price)*r.quantity};});state.migrationReview=JSON.parse(this.get('review')||'[]');}
    return state;
  }
  addUser(username,password,role='player',owners=[]){username=text(username,60);if(!/^[\p{L}\p{N} _.-]{2,60}$/u.test(username))fail('Use 2–60 letters, numbers, spaces, dots or dashes for the account name.');if(!['gm','player'].includes(role))fail('Invalid role.');for(const owner of owners)if(!this.owners().includes(owner))fail('Unknown character.');const user={id:randomUUID(),username,role,password:passwordHash(password)};if(this.db.prepare('SELECT id FROM users WHERE username=?').get(username))fail('That account name is already in use.',409);this.db.prepare('INSERT INTO users(id,username,role,password) VALUES (?,?,?,?)').run(user.id,username,role,user.password);for(const owner of owners)this.db.prepare('INSERT INTO grants VALUES (?,?)').run(user.id,owner);return user;}
  importBundle(bundle){
    if(this.db.prepare('SELECT count(*) n FROM rows').get().n)fail('Import is only available into an empty ledger. Export a backup before replacing a ledger.');
    if(!Array.isArray(bundle.rows)||bundle.rows.length>10000)fail('Invalid import.');const rows=bundle.rows.map(cleanRow),privateRows=(bundle.privateRecords||[]).map(cleanPrivate),ids=new Set(),wallets=new Set();
    for(const row of rows){if(ids.has(row.id))fail('Duplicate item ID in import.');ids.add(row.id);if(row.kind==='wallet'){const k=JSON.stringify([row.owner,row.storage]);if(wallets.has(k))fail('Duplicate wallet.');wallets.add(k);}}
    if(new Set(privateRows.map(r=>r.id)).size!==privateRows.length)fail('Duplicate private record.');
    return this.transaction(()=>{for(const n of new Set([...(bundle.owners||[]),...rows.map(r=>r.owner)]))this.db.prepare('INSERT OR IGNORE INTO owners VALUES (?)').run(text(n,120));for(const n of new Set(['Carried',...(bundle.locations||[]),...rows.map(r=>r.storage)]))this.db.prepare('INSERT OR IGNORE INTO locations VALUES (?)').run(text(n,120));for(const r of rows)this.putRow(r);for(const r of privateRows)this.putPrivate(r);for(const lineage of bundle.lineages||[]){if(typeof lineage.sourceId!=='string'||typeof lineage.targetId!=='string'||lineage.sourceId.length>256||lineage.targetId.length>256)fail('Invalid item ancestry.');this.db.prepare('INSERT INTO lineages VALUES (?,?)').run(lineage.targetId,lineage.sourceId);}if(bundle.title)this.set('title',text(bundle.title,120));if(bundle.migrationReview){if(!Array.isArray(bundle.migrationReview)||JSON.stringify(bundle.migrationReview).length>200000)fail('Invalid migration review.');this.set('review',JSON.stringify(bundle.migrationReview));}this.bump();this.bump(true);this.audit('local host','initial import',{rows:rows.length,privateRecords:privateRows.length});return {rows:rows.length,privateRecords:privateRows.length};});
  }
  edit(user,id,changes,version){return this.transaction(()=>{const row=this.row(id);if(!this.canEdit(user,row))fail('You can edit only your assigned characters.',403);this.checkVersion(row,version);const fields=row.kind==='wallet'?['pp','gp','sp','cp']:['name','quantity','uses','weight','price','sell','storage','notes','properties'];if(Object.keys(changes).some(k=>!fields.includes(k)))fail('That field cannot be edited here.',403);const next=cleanRow({...row,...changes});if(!this.locations().includes(next.storage))fail('Choose a GM-defined location.');this.putRow(next);this.bump();this.audit(user.id,'edit public row',{id,fields:Object.keys(changes)});return next;});}
  editPrivate(user,id,changes,version){this.gm(user);return this.transaction(()=>{const row=this.row(id);this.checkVersion(row,version);if(row.kind!=='item')fail('Choose an inventory item.');const allowed=['trueName','actualValue','secretProperties','gmNotes'];if(Object.keys(changes).some(k=>!allowed.includes(k)))fail('Invalid private field.');const prior=this.privateRow(id)||{id,owner:row.owner,trueName:row.name};this.putPrivate({...prior,...changes,id,owner:row.owner});this.putRow(row);this.bump(true);this.audit(user.id,'edit private record',{id,fields:Object.keys(changes)});});}
  reveal(user,id,fields,version){this.gm(user);return this.transaction(()=>{const row=this.row(id);this.checkVersion(row,version);const p=this.privateRow(id);if(!p||!Array.isArray(fields)||!fields.length||fields.some(f=>!['name','price','properties'].includes(f)))fail('Select name, value or properties to reveal.');if(fields.includes('name')){if(!p.trueName)fail('Enter the true name first.');row.name=p.trueName;p.nameRevealed=true;}if(fields.includes('price')){if(p.actualValue===null)fail('Enter the actual value first.');row.price=p.actualValue;p.valueRevealed=true;}if(fields.includes('properties')){row.properties=p.secretProperties;p.propertiesRevealed=true;}this.putPrivate(p);this.putRow(row);this.bump();this.bump(true);this.audit(user.id,'reveal',{id,fields});});}
  offer(user,id,recipient,quantity,storage,version,claim=false){return this.transaction(()=>{const row=this.row(id);this.checkVersion(row,version);if(row.kind!=='item')fail('Choose an item.');if(claim){if(row.owner!=='Party Loot'||!this.grantOwners(user).includes(recipient))fail('Choose your own character for a loot request.',403);}else if(!this.canEdit(user,row))fail('You cannot offer another character’s item.',403);if(!this.owners().includes(recipient)||recipient===row.owner)fail('Choose another inventory.');if(!this.locations().includes(storage))fail('Choose a GM-defined location.');if(typeof quantity!=='number'||!Number.isFinite(quantity)||quantity<=0||quantity>row.quantity)fail('Choose an available quantity.');if(row.uses!==null&&quantity!==row.quantity)fail('Charged stacks must be transferred in full to preserve remaining uses.');const trade={id:randomUUID(),itemId:id,itemName:row.name,source:row.owner,recipient,quantity,storage,sourceVersion:row.version,createdBy:user.id,status:'pending',claim,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO trades VALUES (?,?)').run(trade.id,JSON.stringify(trade));this.audit(user.id,claim?'request loot':'offer trade',{tradeId:trade.id});return trade;});}
  answer(user,id,decision){return this.transaction(()=>{const stored=this.db.prepare('SELECT body FROM trades WHERE id=?').get(id);if(!stored)fail('Trade not found.',404);const trade=JSON.parse(stored.body);if(trade.status!=='pending')fail('This trade is already closed.',409);const accept=user.role==='gm'||(!trade.claim&&this.grantOwners(user).includes(trade.recipient)),cancel=user.role==='gm'||trade.createdBy===user.id;if(!['accept','decline','cancel'].includes(decision)||(decision==='cancel'?!cancel:!accept))fail('You cannot perform that trade action.',403);if(decision==='accept'){const row=this.row(trade.itemId);this.checkVersion(row,trade.sourceVersion);if(row.quantity<trade.quantity)fail('Quantity changed; create another offer.',409);if(!this.locations().includes(trade.storage))fail('Location is no longer available.');const p=this.privateRow(row.id);if(trade.quantity===row.quantity){row.owner=trade.recipient;row.storage=trade.storage;this.putRow(row);if(p)this.putPrivate({...p,owner:row.owner});}else{const newId=randomUUID();this.db.prepare('INSERT INTO lineages VALUES (?,?)').run(newId,row.id);this.putRow({...row,quantity:row.quantity-trade.quantity});this.putRow({...row,id:newId,owner:trade.recipient,storage:trade.storage,quantity:trade.quantity});if(p)this.putPrivate({...p,id:newId,owner:trade.recipient});}this.bump();this.bump(true);}trade.status=decision==='accept'?'accepted':decision==='decline'?'declined':'cancelled';this.db.prepare('UPDATE trades SET body=? WHERE id=?').run(JSON.stringify(trade),id);this.audit(user.id,'trade '+trade.status,{id});return trade;});}
  setLocations(user,names){this.gm(user);if(!Array.isArray(names)||names.length>200)fail('Invalid location list.');const next=[...new Set(['Carried',...names.map(n=>text(n,120))])];if(next.some(n=>!n))fail('Locations need names.');if(this.rows().some(r=>!next.includes(r.storage)))fail('Move every item and wallet before removing its location.');return this.transaction(()=>{this.db.exec('DELETE FROM locations');for(const n of next)this.db.prepare('INSERT INTO locations VALUES (?)').run(n);this.bump();this.audit(user.id,'locations',{names:next});});}
  addInventory(user,name){this.gm(user);name=text(name,120);if(!name)fail('Enter a character or loot inventory name.');this.db.prepare('INSERT OR IGNORE INTO owners VALUES (?)').run(name);this.bump();}
  addRow(user,raw){if(!this.owners().includes(raw.owner)||!this.locations().includes(raw.storage))fail('Choose an existing inventory and location.');if(!this.canEdit(user,raw))fail('You can add items only to your assigned characters.',403);return this.transaction(()=>{const row=this.putRow({...raw,id:randomUUID()});if(row.kind==='wallet'&&this.rows().filter(r=>r.kind==='wallet'&&r.owner===row.owner&&r.storage===row.storage).length>1)fail('That inventory already has a wallet at this location.');if(row.kind==='item')this.putPrivate({id:row.id,owner:row.owner,trueName:row.name,actualValue:null});this.bump();this.audit(user.id,'add row',{id:row.id});return row;});}
  exportBundle(){return {schema:1,title:this.get('title'),owners:this.owners(),locations:this.locations(),rows:this.rows().map(({version,...r})=>r),privateRecords:this.db.prepare('SELECT body FROM private_rows').all().map(r=>JSON.parse(r.body)),migrationReview:JSON.parse(this.get('review')||'[]'),lineages:this.db.prepare('SELECT source_id AS sourceId,target_id AS targetId FROM lineages').all().map(({sourceId,targetId})=>({sourceId,targetId}))};}
  close(){if(this.ownsDatabase)this.db.close();}
}
installFeatures(Ledger,{fail,text,hash});

installCharacters(Ledger);

installHub(Ledger);

installCommunity(Ledger);

installCampaign(Ledger);
installCalendar(Ledger);
installPlay(Ledger);
