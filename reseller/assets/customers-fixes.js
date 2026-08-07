/* Customer subscription flow fixes */
reviewSubscription = function(id){
  selectedSubscriptionProduct=subscriptionProducts.find(p=>p.id===id);
  if(!selectedSubscriptionProduct)return;
  const app=String(selectedSubscriptionProduct.app_name||"").toLowerCase();
  const type=String(selectedSubscriptionProduct.account_type||"").toLowerCase();
  const showNetflixProfile=app==="netflix"&&(type.includes("1 user")||type.includes("one user"));
  qs("subscriptionStep").innerHTML=`<button class="step-back" onclick="renderDurations()">← Durations</button><div class="subscription-review"><div class="review-row"><span>Customer</span><strong>${safe(customerFullName(selectedCustomer))}</strong></div><div class="review-row"><span>Service</span><strong>${safe(selectedSubscriptionProduct.app_name)}</strong></div><div class="review-row"><span>Type</span><strong>${safe(selectedSubscriptionProduct.account_type||"Standard")}</strong></div><div class="review-row"><span>Duration</span><strong>${safe(selectedSubscriptionProduct.duration)}</strong></div><div class="review-row"><span>Your price</span><strong>${money(priceFor(id))}</strong></div></div>${showNetflixProfile?`<label class="form-group profile-field"><span class="form-label">Netflix profile / username <em>optional</em></span><input class="form-input" id="subscriptionProfileName" maxlength="80" placeholder="Profile name or username"></label>`:""}<div id="purchaseMessage" class="form-message"></div><button class="purchase-btn" id="purchaseCustomerBtn" onclick="purchaseCustomerSubscription()">Confirm Purchase • ${money(priceFor(id))}</button>`;
};
