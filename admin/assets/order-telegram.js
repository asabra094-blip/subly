/* Subly admin order Telegram bridge — notification only; order logic remains in orders.js. */
(()=>{
  if(window.__sublyOrderTelegramBridge)return;
  window.__sublyOrderTelegramBridge=true;

  let bridgeOrderId=null;
  const originalOpen=window.openDeliverOrder;
  const originalSubmit=window.submitDeliverOrder;
  const originalClose=window.closeDeliverOrder;
  if(typeof originalSubmit!=='function')return;

  if(typeof originalOpen==='function')window.openDeliverOrder=function(id){
    bridgeOrderId=id||null;
    return originalOpen.apply(this,arguments);
  };
  if(typeof originalClose==='function')window.closeDeliverOrder=function(){
    bridgeOrderId=null;
    return originalClose.apply(this,arguments);
  };

  window.submitDeliverOrder=async function(){
    const orderId=bridgeOrderId;
    await originalSubmit.apply(this,arguments);
    if(!orderId)return;

    try{
      const {data:order,error}=await supabaseClient.from('orders').select('id,status').eq('id',orderId).maybeSingle();
      if(error||order?.status!=='delivered')return;
      const {data,error:notifyError}=await supabaseClient.functions.invoke('send-reseller-notification',{
        body:{event:'order_delivered',order_id:orderId}
      });
      if(notifyError)console.error('Delivered Telegram notification failed:',notifyError);
      else if(data?.ok===false)console.error('Delivered Telegram notification failed:',data.error||data);
    }catch(error){console.error('Delivered Telegram notification error:',error);}
  };
})();
