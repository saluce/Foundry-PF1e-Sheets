const choices=[['system','System'],['light','Light'],['charcoal','Charcoal Dark'],['oled','OLED Dark']];
let choice='system',pending=false;try{choice=localStorage.getItem('wr-theme')||'system';}catch{}
const media=matchMedia('(prefers-color-scheme: dark)');
export function currentTheme(){return choice;}
export function applyTheme(value){choice=choices.some(([k])=>k===value)?value:'system';document.documentElement.dataset.theme=choice==='system'?(media.matches?'charcoal':'light'):choice;document.documentElement.dataset.themeChoice=choice;try{localStorage.setItem('wr-theme',choice);}catch{}document.querySelectorAll('[data-theme-selector]').forEach(el=>el.value=choice);}
export function acceptAccountTheme(value){if(pending){pending=false;return choice;}applyTheme(value||'system');return null;}
media.addEventListener('change',()=>{if(choice==='system')applyTheme(choice);});applyTheme(choice);
function enhance(){const target=document.querySelector('.auth-form')||document.querySelector('.topbar');if(!target||target.querySelector('[data-theme-selector]'))return;const wrapper=document.createElement('label');wrapper.className='theme-control';wrapper.innerHTML=`<span>Appearance</span><select aria-label="Appearance" data-theme-selector>${choices.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select>`;target.prepend(wrapper);wrapper.querySelector('select').value=choice;wrapper.querySelector('select').onchange=ev=>{applyTheme(ev.target.value);pending=true;document.dispatchEvent(new CustomEvent('wr-theme-change',{detail:choice}));};}
new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});enhance();
