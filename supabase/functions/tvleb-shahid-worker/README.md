# TV Leb Shahid worker

Internal server-side worker for Subly's Shahid supplier integration.

## Safety gates

- The supplier API key stays in Supabase Vault and is never shipped to the browser.
- `supplier_integrations.enabled` and `supplier_integrations.live_purchase_enabled` must both be `true`.
- The selected Shahid product mapping must also be enabled.
- A database purchase guard allows only one supplier purchase attempt per Subly order.
- A worker claim that dies while still in the **pre-purchase** `preparing` state can be recovered after a five-minute lease. This is safe because `/buy` has not started yet.
- Once the guard reaches `in_progress`, `/buy` may have started. Network timeouts / HTTP 5xx are then treated as **ambiguous** and are never auto-retried or auto-refunded.
- An ambiguous purchase freezes that reseller's Shahid queue until an admin resolves the uncertain order.
- Definite pre-purchase or supplier rejection errors can refund the reseller wallet atomically and then release the next queued order.
- Supplier cost is checked with the read-only `/types` endpoint before buying. An unexpected cost increase blocks and refunds the Subly order instead of buying at a loss.

## Reseller routing

- The TV Leb `customerPhone` sent for automated Shahid purchases comes from the Subly reseller profile (`profiles.phone`), not from the reseller's end-customer record.
- This keeps all of one reseller's Shahid purchases attached to that reseller's customer card in the OStories / TV Leb dealer portal.
- The reseller phone can be entered when the reseller is created and edited later from Admin → Resellers → Manage → Settings.
- Subly's own end-customer remains attached to the Subly order for the reseller's internal customer tracking; that end-customer is not used to choose the OStories customer card.

## Per-reseller FIFO queue

- Every reseller has a serialized Shahid queue ordered by Subly `order_number`.
- Only the oldest unresolved Shahid order for that reseller can reach `/buy`.
- Later Shahid orders stay queued even if their worker requests arrive first or at the same time.
- A pending supplier fulfillment keeps the next order locked.
- After the first order is delivered, or after a definite safe failure is refunded, Subly dispatches the next queued Shahid order automatically.
- The one-minute cron job also performs a queue sweep as a recovery path if an async worker dispatch is ever missed.

## Safe profile matching

Before each real `/buy`, the worker reads the reseller's existing Shahid subscriptions from the supplier and stores a small baseline containing supplier account ID, profile name, email and account type. No supplier passwords are stored in this baseline.

If TV Leb later returns the same shared Shahid account ID for another purchase under the same reseller phone, Subly compares the account after purchase with the saved baseline. It delivers only the uniquely new profile. If the new profile cannot be identified uniquely yet, the order remains pending instead of guessing.

This is what makes a flow such as `Rashid order #1 → delivered → Rashid order #2 → delivered` safe while both subscriptions remain under Rashid's single OStories customer card.

## Fulfillment

1. A new eligible Shahid order enters that reseller's FIFO queue.
2. Only the first unresolved order is claimed by the worker.
3. The worker validates the reseller routing phone, live package price and supplier package availability.
4. The worker captures the reseller's pre-purchase Shahid profile baseline.
5. The worker calls `/api/v1/shahid/buy` only after all safety checks pass.
6. The supplier subscription ID, reseller routing phone and safe matching metadata are stored.
7. Active or pending subscriptions are resolved with `/subscription/:id` and matched using the reseller phone plus the saved baseline / expected purchase details.
8. Pending subscriptions are polled by the one-minute cron dispatcher.
9. When the correct profile becomes active, Subly fills the account email, password, profile and supplier expiry date, marks the order delivered, and the existing Subly notification/Telegram flow fires.
10. Delivery releases the next Shahid order for that reseller.

Live purchase flags are intentionally left disabled until a controlled real-money test is approved.
