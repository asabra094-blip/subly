# TV Leb Shahid worker

Internal server-side worker for Subly's Shahid supplier integration.

## Safety gates

- The supplier API key stays in Supabase Vault and is never shipped to the browser.
- `supplier_integrations.enabled` and `supplier_integrations.live_purchase_enabled` must both be `true`.
- The selected Shahid product mapping must also be enabled.
- A database purchase guard allows only one supplier purchase attempt per Subly order.
- Once a POST `/buy` request has started, network timeouts / HTTP 5xx are treated as **ambiguous** and are never auto-retried or auto-refunded.
- Definite pre-purchase or supplier rejection errors can refund the reseller wallet atomically.
- Supplier cost is checked with the read-only `/types` endpoint before buying. An unexpected cost increase blocks and refunds the Subly order instead of buying at a loss.

## Fulfillment

1. A new eligible Shahid order is queued to this worker.
2. The worker validates customer details and supplier package availability.
3. The worker calls `/api/v1/shahid/buy` only after all safety checks pass.
4. The supplier subscription ID and customer phone are stored.
5. Active subscriptions are resolved with `/subscription/:id` and matched by phone before delivery.
6. Pending subscriptions are polled by a one-minute cron dispatcher. Shared supplier account IDs are grouped so one status request can resolve multiple customer profiles.
7. When the matching profile becomes active, Subly fills the order credentials, uses the supplier expiry date, marks the order delivered, and the existing Subly notification/Telegram flow fires.

Live purchase flags are intentionally left disabled until a controlled real-money test is approved.
