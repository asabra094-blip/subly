import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc=(v:unknown)=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const money=(v:unknown)=>`$${Number(v||0).toFixed(2)}`;
const date=(v:unknown,l="en")=>v?new Intl.DateTimeFormat("en",{year:"numeric",month:"short",day:"numeric",timeZone:"Asia/Beirut"}).format(new Date(String(v))):"—";
const res=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json"}});
const plan=(v:unknown,l="en")=>{
  const raw=String(v??"").trim();
  if(l!=="ar")return raw;
  const low=raw.toLowerCase();
  const fixed:Record<string,string>={"full account":"حساب كامل","full":"حساب كامل","1 user":"مستخدم واحد","one user":"مستخدم واحد","single user":"مستخدم واحد","standard":"عادي"};
  if(fixed[low])return fixed[low];
  const m=low.match(/^([\d.]+)\s*(month|months|year|years|week|weeks|day|days)$/i);
  if(!m)return raw;
  const n=Number(m[1]),num=m[1],unit=m[2].toLowerCase();
  if(unit.startsWith("month"))return n===1?"شهر واحد":n===2?"شهران":`${num} أشهر`;
  if(unit.startsWith("year"))return n===1?"سنة واحدة":n===2?"سنتان":`${num} سنوات`;
  if(unit.startsWith("week"))return n===1?"أسبوع واحد":n===2?"أسبوعان":`${num} أسابيع`;
  if(unit.startsWith("day"))return n===1?"يوم واحد":n===2?"يومان":`${num} أيام`;
  return raw;
};
const paymentMethod=(v:unknown,l="en")=>{const s=String(v??"");if(s==="whish_money")return "Whish Money";if(s==="cash")return l==="ar"?"نقداً":"Cash";if(s==="crypto")return "Crypto";return s;};
const issueLabel=(v:unknown,l="en")=>{const s=String(v??"");if(l!=="ar")return s.replaceAll("_"," ");return ({account_not_working:"الحساب لا يعمل",wrong_password:"كلمة المرور خاطئة",profile_problem:"مشكلة في الملف",link_not_working:"الرابط لا يعمل",payment_issue:"مشكلة دفع",other:"مشكلة أخرى"} as Record<string,string>)[s]||s.replaceAll("_"," ");};

Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=="POST")return res({ok:false},405);
  const secret=req.headers.get("x-subly-reseller-v2")||"";
  if(!secret)return res({ok:false},401);
  const token=Deno.env.get("RESELLER_TELEGRAM_BOT_TOKEN"),url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!token||!url||!key)throw new Error("Server configuration incomplete");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:valid}=await db.rpc("validate_internal_webhook_secret",{p_name:"subly_reseller_notify_secret",p_secret:secret});
  if(valid!==true)return res({ok:false},401);
  const b=await req.json(),event=String(b?.event||""),id=String(b?.entity_id||"");
  if(!event||!id)return res({ok:false},400);
  let uid="",ctx:any={};

  if(event==="subscription_updated"){
   const{data:o}=await db.from("orders").select("id,subscription_code,user_id,product_id,customer_id,price_paid,customer_profile_name,delivery_account,delivery_password,delivery_profile,delivery_pin,delivery_url,delivery_notes,expires_at").eq("id",id).maybeSingle();
   if(!o)throw new Error("Order not found");uid=o.user_id;
   const[{data:p},{data:c}]=await Promise.all([db.from("products").select("app_name,account_type,duration").eq("id",o.product_id).maybeSingle(),o.customer_id?db.from("customers").select("first_name,last_name,phone").eq("id",o.customer_id).maybeSingle():Promise.resolve({data:null})]);
   ctx={o,p,c,code:o.subscription_code||`SUB-${String(o.id).replaceAll("-","").slice(0,8).toUpperCase()}`};
  } else if(event.startsWith("order_")){
   const{data:o}=await db.from("orders").select("id,subscription_code,user_id,product_id,customer_id,price_paid,customer_profile_name,delivery_account,delivery_password,delivery_profile,delivery_pin,delivery_url,delivery_notes,rejection_reason,expires_at").eq("id",id).maybeSingle();
   if(!o)throw new Error("Order not found");uid=o.user_id;
   const[{data:p},{data:c},{data:w}]=await Promise.all([db.from("products").select("app_name,account_type,duration").eq("id",o.product_id).maybeSingle(),o.customer_id?db.from("customers").select("first_name,last_name,phone").eq("id",o.customer_id).maybeSingle():Promise.resolve({data:null}),event==="order_refunded"?db.from("wallets").select("balance").eq("user_id",uid).maybeSingle():Promise.resolve({data:null})]);
   ctx={o,p,c,w,code:o.subscription_code||`SUB-${String(o.id).replaceAll("-","").slice(0,8).toUpperCase()}`};
  } else if(event.startsWith("topup_")){
   const{data:t}=await db.from("topup_requests").select("user_id,amount,payment_method").eq("id",id).maybeSingle();if(!t)throw new Error("Top-up not found");uid=t.user_id;
   const{data:w}=event==="topup_approved"?await db.from("wallets").select("balance").eq("user_id",uid).maybeSingle():{data:null};ctx={t,w};
  } else if(event.startsWith("renewal_")){
   const{data:r}=await db.from("renewals").select("order_id,user_id,renewal_product_id,price_paid,new_expires_at").eq("id",id).maybeSingle();if(!r)throw new Error("Renewal not found");uid=r.user_id;
   const[{data:o},{data:p},{data:w}]=await Promise.all([db.from("orders").select("subscription_code,id,expires_at").eq("id",r.order_id).maybeSingle(),db.from("products").select("app_name,duration").eq("id",r.renewal_product_id).maybeSingle(),event==="renewal_cancelled"?db.from("wallets").select("balance").eq("user_id",uid).maybeSingle():Promise.resolve({data:null})]);ctx={r,o,p,w,code:o?.subscription_code||String(r.order_id).slice(0,8)};
  } else if(event.startsWith("support_")){
   const{data:i}=await db.from("subscription_issues").select("reseller_id,order_id,issue_type,admin_note").eq("id",id).maybeSingle();if(!i)throw new Error("Support issue not found");uid=i.reseller_id;
   const{data:o}=await db.from("orders").select("subscription_code,product_id").eq("id",i.order_id).maybeSingle(),{data:p}=o?.product_id?await db.from("products").select("app_name").eq("id",o.product_id).maybeSingle():{data:null};ctx={i,o,p,code:o?.subscription_code||String(i.order_id).slice(0,8)};
  } else return res({ok:true,ignored:true});

  const[{data:profile},{data:conn}]=await Promise.all([db.from("profiles").select("language_preference").eq("id",uid).maybeSingle(),db.from("reseller_telegram_connections").select("telegram_chat_id,notifications_enabled").eq("reseller_id",uid).maybeSingle()]);
  if(!conn?.telegram_chat_id||conn.notifications_enabled===false)return res({ok:true,skipped:true});
  const ar=profile?.language_preference==="ar",lang=ar?"ar":"en";
  let msgs:string[]=[];
  const planLines=(p:any)=>[
   p?.account_type?`${ar?"<b>نوع الحساب:</b>":"<b>Plan:</b>"} ${esc(plan(p.account_type,lang))}`:"",
   p?.duration?`${ar?"<b>المدة:</b>":"<b>Duration:</b>"} ${esc(plan(p.duration,lang))}`:""
  ].filter(Boolean);
  const accountBlock=(o:any,p:any,code:string)=>{const profileName=o.delivery_profile||o.customer_profile_name,appKey=String(p?.app_name||"").toLowerCase().replace(/[^a-z0-9]/g,""),full=String(p?.account_type||"").toLowerCase().includes("full"),profileLabel=appKey==="anghami"?(ar?"<b>ملف Anghami:</b>":"<b>Anghami Profile:</b>"):(ar?"<b>الملف:</b>":"<b>Profile:</b>"),linkLabel=appKey==="netflix"&&full?(ar?"<b>رابط الأكواد:</b>":"<b>Codes Link:</b>"):appKey==="netflix"?(ar?"<b>رابط Netflix:</b>":"<b>Netflix Link:</b>"):["osn","osnplus"].includes(appKey)?(ar?"<b>رابط OTP:</b>":"<b>OTP Link:</b>"):(ar?"<b>الرابط:</b>":"<b>Link:</b>");return [`✅ <b>${esc(p?.app_name||"Subscription")} ${ar?"اشتراك":"Subscription"}</b>`,...planLines(p),"",o.delivery_account?`${ar?"<b>الحساب / البريد:</b>":"<b>Account / Email:</b>"} <code>${esc(o.delivery_account)}</code>`:"",o.delivery_password?`${ar?"<b>كلمة المرور:</b>":"<b>Password:</b>"} <code>${esc(o.delivery_password)}</code>`:"",profileName?`${profileLabel} <code>${esc(profileName)}</code>`:"",o.delivery_pin?`<b>PIN:</b> <code>${esc(o.delivery_pin)}</code>`:"",o.delivery_url?`${linkLabel} ${esc(o.delivery_url)}`:"",o.expires_at?`${ar?"<b>ينتهي:</b>":"<b>Expires:</b>"} ${date(o.expires_at,lang)}`:"",o.delivery_notes?`${ar?"<b>ملاحظات:</b>":"<b>Notes:</b>"} ${esc(o.delivery_notes)}`:"",`${ar?"<b>معرّف الاشتراك:</b>":"<b>Subscription ID:</b>"} <code>${esc(code)}</code>`].filter(Boolean).join("\n")};

  if(event==="order_delivered"){
   const{o,p,c,code}=ctx,customer=c?[c.first_name,c.last_name].filter(Boolean).join(" ").trim():"";
   msgs.push([ar?"✅ <b>تم تسليم الاشتراك</b>":"✅ <b>Subscription Delivered</b>","",`${ar?"<b>معرّف الاشتراك:</b>":"<b>Subscription ID:</b>"} <code>${esc(code)}</code>`,`${ar?"<b>الخدمة:</b>":"<b>App:</b>"} ${esc(p?.app_name||"Subscription")}`,...planLines(p),customer?`${ar?"<b>العميل:</b>":"<b>Customer:</b>"} ${esc(customer)}`:"",c?.phone?`${ar?"<b>الهاتف:</b>":"<b>Phone:</b>"} <code>${esc(c.phone)}</code>`:""].filter(Boolean).join("\n"));
   msgs.push(accountBlock(o,p,code));
  } else if(event==="subscription_updated"){
   const{o,p,c,code}=ctx,customer=c?[c.first_name,c.last_name].filter(Boolean).join(" ").trim():"";
   msgs.push([ar?"✏️ <b>تم تحديث بيانات الاشتراك</b>":"✏️ <b>Subscription Updated</b>","",`${ar?"<b>معرّف الاشتراك:</b>":"<b>Subscription ID:</b>"} <code>${esc(code)}</code>`,`${ar?"<b>الخدمة:</b>":"<b>App:</b>"} ${esc(p?.app_name||"Subscription")}`,...planLines(p),customer?`${ar?"<b>العميل:</b>":"<b>Customer:</b>"} ${esc(customer)}`:""].filter(Boolean).join("\n"));
   msgs.push(accountBlock(o,p,code));
  } else if(event==="order_refunded"){
   const{o,p,w,code}=ctx;msgs=[[ar?"↩️ <b>تم استرداد الاشتراك</b>":"↩️ <b>Subscription Refunded</b>","",`${ar?"<b>معرّف الاشتراك:</b>":"<b>Subscription ID:</b>"} <code>${esc(code)}</code>`,`${ar?"<b>الخدمة:</b>":"<b>App:</b>"} ${esc(p?.app_name||"Subscription")}`,`${ar?"<b>المبلغ المسترد:</b>":"<b>Refund:</b>"} ${money(o.price_paid)}`,o.rejection_reason?`${ar?"<b>السبب:</b>":"<b>Reason:</b>"} ${esc(o.rejection_reason)}`:"",w?.balance!=null?`${ar?"<b>الرصيد الجديد:</b>":"<b>New Balance:</b>"} ${money(w.balance)}`:""].filter(Boolean).join("\n")];
  } else if(event.startsWith("topup_")){
   const{t,w}=ctx;msgs=[[event==="topup_approved"?(ar?"✅ <b>تم قبول التعبئة</b>":"✅ <b>Top-Up Approved</b>"):(ar?"❌ <b>تم رفض التعبئة</b>":"❌ <b>Top-Up Rejected</b>"),"",`${ar?"<b>المبلغ:</b>":"<b>Amount:</b>"} ${money(t.amount)}`,`${ar?"<b>الطريقة:</b>":"<b>Method:</b>"} ${esc(paymentMethod(t.payment_method,lang))}`,w?.balance!=null?`${ar?"<b>الرصيد الجديد:</b>":"<b>New Balance:</b>"} ${money(w.balance)}`:""].filter(Boolean).join("\n")];
  } else if(event.startsWith("renewal_")){
   const{r,o,p,w,code}=ctx;msgs=[[event==="renewal_completed"?(ar?"🔁 <b>تم التجديد</b>":"🔁 <b>Renewal Completed</b>"):(ar?"❌ <b>تم إلغاء التجديد وإعادة المبلغ</b>":"❌ <b>Renewal Cancelled & Refunded</b>"),"",`${ar?"<b>معرّف الاشتراك:</b>":"<b>Subscription ID:</b>"} <code>${esc(code)}</code>`,event==="renewal_completed"?`${ar?"<b>الخدمة:</b>":"<b>App:</b>"} ${esc(p?.app_name||"Subscription")}`:"",event==="renewal_completed"&&p?.duration?`${ar?"<b>المدة:</b>":"<b>Duration:</b>"} ${esc(plan(p.duration,lang))}`:"",event==="renewal_completed"?`${ar?"<b>تاريخ الانتهاء الجديد:</b>":"<b>New Expiry:</b>"} ${date(r.new_expires_at||o?.expires_at,lang)}`:`${ar?"<b>المبلغ المسترد:</b>":"<b>Refund:</b>"} ${money(r.price_paid)}`,w?.balance!=null?`${ar?"<b>الرصيد الجديد:</b>":"<b>New Balance:</b>"} ${money(w.balance)}`:""].filter(Boolean).join("\n")];
  } else {
   const{i,p,code}=ctx;msgs=[[event==="support_in_progress"?(ar?"🛠️ <b>تحديث من الدعم</b>":"🛠️ <b>Support Update</b>"):(ar?"✅ <b>تم حل طلب الدعم</b>":"✅ <b>Support Resolved</b>"),"",`${ar?"<b>معرّف الاشتراك:</b>":"<b>Subscription ID:</b>"} <code>${esc(code)}</code>`,`${ar?"<b>الخدمة:</b>":"<b>App:</b>"} ${esc(p?.app_name||"Subscription")}`,`${ar?"<b>المشكلة:</b>":"<b>Problem:</b>"} ${esc(issueLabel(i.issue_type,lang))}`,i.admin_note?`${ar?"<b>رد الإدارة:</b>":"<b>Admin Reply:</b>"} ${esc(i.admin_note)}`:""].filter(Boolean).join("\n")];
  }
  for(const text of msgs){const tg=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:conn.telegram_chat_id,text,parse_mode:"HTML",disable_web_page_preview:true})});if(!tg.ok)throw new Error(`Telegram ${tg.status}`)}
  return res({ok:true,sent:true,event,messages_sent:msgs.length,language:lang});
 }catch(e){console.error("reseller-notifications-v2",e);return res({ok:false,error:String((e as any)?.message||e)},500)}
});