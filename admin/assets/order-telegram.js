/* Subly admin order Telegram bridge — keeps notification delivery separate from order business logic. */
(()=>{
  if(window.__sublyOrderTelegramBridge)return;
  window.__sublyOrderTelegramBridge=true;

  const original=window.submitDeliverOrder;
  if(typeof original!=='function')return;

  window.submitDeliverOrder=async function(){
    const orderId=window.selectedAdminOrderId;
    if(!orderId)return original.apply(this,arguments);

    await original.apply(this,arguments);

    try{
      const {data:order,error}=await window.supabaseClient
        .from('orders')
        .select('id,status')
        .eq('id',orderId)
        .maybeSingle();
      if(error||order?.status!=='delivered')return;

      const {data,error:notifyError}=await window.supabaseClient.functions.invoke('send-reseller-notification',{
        body:{event:'order_delivered',order_id:orderId}
      });
      if(notifyError)console.error('Delivered Telegram notification failed:',notifyError);
      else if(data?.ok===false)console.error('Delivered Telegram notification failed:',data.error||data);
    }catch(error){
      console.error('Delivered Telegram notification error:',error);
    }
  };
})();
