/* Subly admin settings */
function adminSettingsMessage(message,type=''){
  const el=document.getElementById('adminPasswordMessage');if(!el)return;
  el.textContent=message||'';el.className='admin-settings-message'+(type?' '+type:'');
}
function toggleAdminPasswords(){
  const show=document.getElementById('adminShowPasswords')?.checked;
  ['adminCurrentPassword','adminNewPassword','adminConfirmPassword'].forEach(id=>{const el=document.getElementById(id);if(el)el.type=show?'text':'password'});
}
function adminPasswordStrength(value){
  const v=String(value||'');let score=0;
  if(v.length>=8)score++;
  if(v.length>=12)score++;
  if(/[a-z]/.test(v)&&/[A-Z]/.test(v))score++;
  if(/\d/.test(v))score++;
  if(/[^A-Za-z0-9]/.test(v))score++;
  return Math.min(score,4);
}
function updateAdminPasswordStrength(){
  const input=document.getElementById('adminNewPassword'),bar=document.getElementById('adminPasswordStrengthBar'),label=document.getElementById('adminPasswordStrengthLabel');
  if(!input||!bar||!label)return;
  const score=adminPasswordStrength(input.value),pct=[0,25,50,75,100][score];
  bar.style.width=pct+'%';bar.dataset.score=String(score);
  label.textContent=!input.value?'':['Too weak','Weak','Okay','Strong','Very strong'][score];
}
function fillAdminSettingsIdentity(){
  const user=document.getElementById('adminSettingsUsername'),role=document.getElementById('adminSettingsRole');
  if(user)user.textContent=currentAdminProfile?.username||'Administrator';
  if(role)role.textContent=currentAdminProfile?.role==='admin'?'Admin':'—';
}
async function changeAdminPassword(event){
  event?.preventDefault();
  const current=document.getElementById('adminCurrentPassword')?.value||'';
  const next=document.getElementById('adminNewPassword')?.value||'';
  const confirm=document.getElementById('adminConfirmPassword')?.value||'';
  const button=document.getElementById('adminChangePasswordButton');
  adminSettingsMessage('');
  if(!current){adminSettingsMessage('Enter your current password.','error');return}
  if(next.length<8){adminSettingsMessage('New password must be at least 8 characters.','error');return}
  if(next===current){adminSettingsMessage('Choose a new password different from your current password.','error');return}
  if(next!==confirm){adminSettingsMessage('New passwords do not match.','error');return}
  const username=String(currentAdminProfile?.username||'').trim().toLowerCase();
  if(!currentAdminUser||!username){adminSettingsMessage('Your admin account is still loading. Try again in a moment.','error');return}
  button.disabled=true;button.textContent='Verifying…';
  try{
    const auth=await supabaseClient.auth.signInWithPassword({email:username+'@subly.invalid',password:current});
    if(auth.error||!auth.data?.user){adminSettingsMessage('Current password is incorrect.','error');return}
    if(auth.data.user.id!==currentAdminUser.id){await supabaseClient.auth.signOut();location.replace('../login.html');return}
    button.textContent='Changing…';
    const updated=await supabaseClient.auth.updateUser({password:next});
    if(updated.error)throw updated.error;
    document.getElementById('adminCurrentPassword').value='';
    document.getElementById('adminNewPassword').value='';
    document.getElementById('adminConfirmPassword').value='';
    document.getElementById('adminShowPasswords').checked=false;
    toggleAdminPasswords();updateAdminPasswordStrength();
    adminSettingsMessage('Password changed successfully. Use the new password next time you sign in.','success');
  }catch(error){
    console.error('[SUBLY] admin password change failed',error);
    adminSettingsMessage(error?.message||'Could not change password. Try again.','error');
  }finally{
    button.disabled=false;button.textContent='Change Password';
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('adminPasswordForm')?.addEventListener('submit',changeAdminPassword);
  document.getElementById('adminShowPasswords')?.addEventListener('change',toggleAdminPasswords);
  document.getElementById('adminNewPassword')?.addEventListener('input',updateAdminPasswordStrength);
});
window.addEventListener('subly:admin-ready',fillAdminSettingsIdentity);
