/* Subly product app status decoration */
(function(){
  const style=document.createElement('style');
  style.textContent=`
    .service-status-badge{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.35px;vertical-align:middle;white-space:nowrap}
    .service-status-badge.disabled{color:#ff9aaa;border:1px solid rgba(255,92,114,.28);background:rgba(255,92,114,.08)}
    .service-group.is-deactivated{border-color:rgba(255,92,114,.20);opacity:.88}
    .service-group.is-deactivated .service-group-logo{filter:saturate(.35);opacity:.72}
    @media(max-width:600px){.service-status-badge{font-size:7px;padding:3px 6px;margin-left:5px}}
  `;
  document.head.appendChild(style);

  function decorate(){
    document.querySelectorAll('#adminProductsList .service-group').forEach(group=>{
      const heading=group.querySelector('.service-group-identity h3');
      if(!heading)return;
      const states=[...group.querySelectorAll('.product-state')];
      if(!states.length)return;
      const allDisabled=states.every(el=>el.classList.contains('off')||/disabled|deactivated/i.test(el.textContent||''));
      group.classList.toggle('is-deactivated',allDisabled);
      let badge=heading.parentElement?.querySelector('.service-status-badge');
      if(allDisabled){
        if(!badge){badge=document.createElement('span');badge.className='service-status-badge disabled';heading.insertAdjacentElement('afterend',badge);}
        badge.className='service-status-badge disabled';
        badge.textContent='⏸ Deactivated';
      }else if(badge){badge.remove();}
    });
  }

  const target=document.getElementById('adminProductsList');
  if(target){new MutationObserver(()=>requestAnimationFrame(decorate)).observe(target,{childList:true,subtree:true});}
  window.addEventListener('load',()=>setTimeout(decorate,250));
})();