import {randomUUID} from 'node:crypto';
const tables=['meta','owners','locations','rows','private_rows','lineages','grants','invites','trades','audit','item_details','notebooks','game_sessions','preferences','reviews','invite_choices','character_sheets','characters','tributes','build_proposals','actor_profiles','portraits','notices','notice_receipts','campaign_records'];
const contexts=new WeakMap();
export function gameDatabase(raw,gameId='default'){
 if(!/^[a-zA-Z0-9_-]{1,64}$/.test(gameId))throw Error('Invalid game ID.');
 if(!contexts.has(raw)){
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const legacy=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  raw.exec('BEGIN IMMEDIATE');try{
   if(legacy)raw.exec('ALTER TABLE users RENAME TO accounts');
   raw.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,role TEXT NOT NULL,password TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_by TEXT,test INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS memberships(game_id TEXT NOT NULL REFERENCES games(id),user_id TEXT NOT NULL REFERENCES accounts(id),role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(game_id,user_id));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL,view_as TEXT,game_id TEXT NOT NULL DEFAULT 'default');
    CREATE TABLE IF NOT EXISTS account_preferences(user_id TEXT PRIMARY KEY REFERENCES accounts(id),theme TEXT NOT NULL DEFAULT 'system',last_game TEXT);
    CREATE TABLE IF NOT EXISTS password_setups(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);`);
   const cols=raw.prepare('PRAGMA table_info(sessions)').all();for(const [name,type]of [['view_as','TEXT'],['game_id',"TEXT NOT NULL DEFAULT 'default'"]])if(!cols.some(c=>c.name===name))raw.exec('ALTER TABLE sessions ADD COLUMN '+name+' '+type);
   const sessionCols=raw.prepare('PRAGMA table_info(sessions)').all();if(!sessionCols.some(c=>c.name==='remembered'))raw.exec('ALTER TABLE sessions ADD COLUMN remembered INTEGER NOT NULL DEFAULT 0');if(!sessionCols.some(c=>c.name==='last_seen')){raw.exec('ALTER TABLE sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0');raw.prepare('UPDATE sessions SET last_seen=?').run(Date.now());}
   const title=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get()?raw.prepare("SELECT value FROM meta WHERE key='title'").get()?.value:'My first game';
   raw.prepare('INSERT OR IGNORE INTO games(id,name) VALUES (?,?)').run('default',title||'My first game');
   for(const table of tables)if(raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))raw.exec('ALTER TABLE '+table+' RENAME TO g_default_'+table);
   if(legacy)raw.exec("INSERT OR IGNORE INTO memberships SELECT 'default',id,role,disabled FROM accounts");
   raw.exec('COMMIT');
  }catch(e){raw.exec('ROLLBACK');throw e;}
  contexts.set(raw,{transaction:false,ledgers:new Map()});
 }
 if(!raw.prepare('SELECT id FROM games WHERE id=?').get(gameId))throw Error('Game not found.');
 const prefix='g_'+gameId.replaceAll('-','_')+'_',view=prefix+'users';
 raw.exec(`CREATE TEMP VIEW IF NOT EXISTS ${view} AS SELECT a.id,a.username,m.role,a.password,(a.disabled OR m.disabled) AS disabled FROM accounts a JOIN memberships m ON a.id=m.user_id WHERE m.game_id='${gameId}';
 CREATE TEMP TRIGGER IF NOT EXISTS ${prefix}insert_user INSTEAD OF INSERT ON ${view} BEGIN INSERT INTO accounts(id,username,role,password,disabled) VALUES (NEW.id,NEW.username,NEW.role,NEW.password,coalesce(NEW.disabled,0)); INSERT INTO memberships VALUES ('${gameId}',NEW.id,NEW.role,coalesce(NEW.disabled,0)); END;
 CREATE TEMP TRIGGER IF NOT EXISTS ${prefix}update_user INSTEAD OF UPDATE ON ${view} BEGIN UPDATE accounts SET password=NEW.password WHERE id=OLD.id; UPDATE memberships SET role=NEW.role,disabled=NEW.disabled WHERE game_id='${gameId}' AND user_id=OLD.id; END;`);
 const rewrite=sql=>sql.replace(/'(?:''|[^'])*'|\b[a-zA-Z_]\w*\b/g,t=>t[0]==="'"?t:t==='users'?view:tables.includes(t)?prefix+t:t).replace(new RegExp('REFERENCES '+view+'\\b','g'),'REFERENCES accounts');
 return {raw,context:contexts.get(raw),prefix,prepare:sql=>raw.prepare(rewrite(sql)),exec:sql=>raw.exec(rewrite(sql)),close:()=>raw.close()};
}
export const gameId=()=>randomUUID();
