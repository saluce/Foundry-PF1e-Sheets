export const sourceStateKey=(world,backend)=>backend==='portal'?world+':portal':world;
export function inventoryConnection(read){
  const portal=read('backend')==='portal',url=String(read(portal?'portalEndpoint':'endpoint')||'').trim(),token=read(portal?'portalToken':'token');
  if(portal){let u;try{u=new URL(url);}catch{throw Error('Enter the website /api/bridge URL in module settings.');}if(u.pathname!=='/api/bridge'||u.search||u.hash||u.username||u.password||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Use an HTTPS website /api/bridge URL, or HTTP on localhost for testing.');}
  else if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url))throw Error('Configure the deployed Google Apps Script /exec URL first.');
  if(!token)throw Error('Enter the connection secret in module settings first.');
  return {portal,url,token};
}
