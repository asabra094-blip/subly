/* Subly reseller settings */
function settingsIsArabic(){return window.SublyLocale?.language==='ar'}
function settingsText(en,ar){return settingsIsArabic()?ar:en}
function setSettingsMessage(message,type=''){
  const el=document.getElementById('passwordMessage');if(!el)return;
  el.textContent=message||'';el.className='settings-message'+(type?' '+type:'');
}
function togglePasswordVisibility(){
  const checked=document.getElementById('showPasswords')?.checked;
  ['currentPassword','newPassword','confirmPassword'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.type=checked?'text':'password';
  });
}
function settingsPasswordStrength(value){
  const v=String(value||'');
  let score=0;
  if(v.length>=8)score++;
  if(v.length>=12)score++;
  if(/[a-z]/.test(v)&&/[A-Z]/.test(v))score++;
  if(/\d/.test(v))score++;
  if(/[^A-Za-z0-9]/.test(v))score++;
  return Math.min(score,4);
}
function updatePasswordStrength(){
  const input=document.getElementById('newPassword'),bar=document.getElementById('passwordStrengthBar'),label=document.getElementById('passwordStrengthLabel');
  if(!input||!bar||!label)return;
  const score=settingsPasswordStrength(input.value),pct=[0,25,50,75,100][score];
  bar.style.width=pct+'%';
  label.textContent=!input.value?'':[
    settingsText('Too weak','ضعيفة جداً'),
    settingsText('Weak','ضعيفة'),
    settingsText('Okay','مقبولة'),
    settingsText('Strong','قوية'),
    settingsText('Very strong','قوية جداً')
  ][score];
  bar.dataset.score=String(score);
}
async function changeResellerPassword(event){
  event?.preventDefault();
  const current=document.getElementById('currentPassword')?.value||'';
  const next=document.getElementById('newPassword')?.value||'';
  const confirm=document.getElementById('confirmPassword')?.value||'';
  const btn=document.getElementById('changePasswordButton');
  setSettingsMessage('');
  if(!current){setSettingsMessage(settingsText('Enter your current password.','أدخل كلمة المرور الحالية.'),'error');return}
  if(next.length<8){setSettingsMessage(settingsText('New password must be at least 8 characters.','يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.'),'error');return}
  if(next===current){setSettingsMessage(settingsText('Choose a new password different from your current password.','اختر كلمة مرور جديدة تختلف عن الحالية.'),'error');return}
  if(next!==confirm){setSettingsMessage(settingsText('New passwords do not match.','كلمتا المرور الجديدتان غير متطابقتين.'),'error');return}
  const username=String(currentProfile?.username||'').trim().toLowerCase();
  if(!currentUser||!username){setSettingsMessage(settingsText('Your account is still loading. Try again in a moment.','ما زال حسابك قيد التحميل. حاول مرة أخرى بعد قليل.'),'error');return}
  btn.disabled=true;btn.textContent=settingsText('Verifying…','جارٍ التحقق…');
  try{
    const auth=await supabaseClient.auth.signInWithPassword({email:username+'@subly.invalid',password:current});
    if(auth.error||!auth.data?.user){setSettingsMessage(settingsText('Current password is incorrect.','كلمة المرور الحالية غير صحيحة.'),'error');return}
    if(auth.data.user.id!==currentUser.id){await supabaseClient.auth.signOut();location.replace('/login.html');return}
    btn.textContent=settingsText('Changing…','جارٍ التغيير…');
    const updated=await supabaseClient.auth.updateUser({password:next});
    if(updated.error)throw updated.error;
    document.getElementById('currentPassword').value='';
    document.getElementById('newPassword').value='';
    document.getElementById('confirmPassword').value='';
    document.getElementById('showPasswords').checked=false;
    togglePasswordVisibility();updatePasswordStrength();
    setSettingsMessage(settingsText('Password changed successfully. Use the new password next time you sign in.','تم تغيير كلمة المرور بنجاح. استخدم كلمة المرور الجديدة في تسجيل الدخول القادم.'),'success');
  }catch(error){
    console.error('[SUBLY] password change failed',error);
    setSettingsMessage(settingsIsArabic()?'تعذر تغيير كلمة المرور. حاول مرة أخرى.':(error?.message||'Could not change password. Try again.'),'error');
  }finally{
    btn.disabled=false;btn.textContent=settingsText('Change Password','تغيير كلمة المرور');
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('passwordForm')?.addEventListener('submit',changeResellerPassword);
  document.getElementById('showPasswords')?.addEventListener('change',togglePasswordVisibility);
  document.getElementById('newPassword')?.addEventListener('input',updatePasswordStrength);
});
