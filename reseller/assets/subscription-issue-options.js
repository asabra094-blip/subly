/* Subly reseller subscription issue options — service-specific report reasons. */
(()=>{
  'use strict';

  const labels={
    en:{
      link_not_working:'Link not working',
      fix_profile:'Fix profile',
      remove_pin:'Remove PIN code',
      change_pin:'Change PIN code',
      change_profile_name:'Change profile name',
      payment_issue:'Report payment issues',
      wrong_password:'Password is wrong',
      wrong_email:'Gmail is wrong'
    },
    ar:{
      link_not_working:'الرابط لا يعمل',
      fix_profile:'إصلاح الملف',
      remove_pin:'إزالة رمز PIN',
      change_pin:'تغيير رمز PIN',
      change_profile_name:'تغيير اسم الملف',
      payment_issue:'الإبلاغ عن مشكلة في الدفع',
      wrong_password:'كلمة المرور خاطئة',
      wrong_email:'البريد الإلكتروني (Gmail) خاطئ'
    }
  };

  const netflixOneUser=['link_not_working','fix_profile','remove_pin','change_pin','change_profile_name','payment_issue'];
  const shahid=['payment_issue','wrong_password','wrong_email'];
  const standard=['wrong_email','wrong_password'];

  function optionsFor(order){
    const app=String(order?.app_name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const account=String(order?.account_type||'').toLowerCase();
    if(app==='netflix'&&!account.includes('full'))return netflixOneUser;
    if(app==='shahid')return shahid;
    return standard;
  }

  function populateIssueTypes(order){
    const select=document.getElementById('issueType');
    if(!select)return;
    const lang=document.documentElement.lang==='ar'?'ar':'en';
    select.replaceChildren(...optionsFor(order).map(value=>{
      const option=document.createElement('option');
      option.value=value;
      option.textContent=labels[lang][value]||labels.en[value]||value;
      return option;
    }));
  }

  window.openIssueModal=function(id){
    const o=rowById(id);
    if(!o)return;
    selectedIssueOrder=o;
    const fallback=document.documentElement.lang==='ar'?'اشتراك':'Subscription';
    document.getElementById('issueSubtitle').textContent=`${o.app_name||fallback} • ${fullName(o)}`;
    populateIssueTypes(o);
    document.getElementById('issueDetails').value='';
    const message=document.getElementById('issueMessage');
    message.textContent='';
    message.className='sub-form-message';
    document.getElementById('issueModal').classList.add('show');
  };
})();
