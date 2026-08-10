# Architecture Notes

Two intelligent contracts on GenLayer Bradbury Testnet (chain id 4221). The
Registry owns listings, LLM validation, the prompt body, and purchaser-gated
content delivery. The Escrow owns payment and settlement. There is **no
off-chain backend** in the core path — gating logic lives in the contracts.

## Contract interaction flow

```
Seller -> PromptRegistry.list_prompt(title, description, target_models_csv,
                                     price_wei, ipfs_cid, body_hash, preview, body)
            |
            +-> gl.eq_principle.strict_eq(duplicate_check)   # LLM consensus
            +-> gl.eq_principle.strict_eq(categorize)        # LLM consensus
            +-> deterministic tag extraction
            |
            v
         Listing + full body stored, status "active"
         (or stored as "rejected" with a reason if a duplicate)

Buyer -> PromptEscrow.buy(prompt_id)   [attaches exactly price_wei GEN]
            |
            +-> registry.view().get_listing_status(prompt_id)      # must be "active"
            +-> registry.view().get_listing_price_wei(prompt_id)   # must equal msg.value
            +-> registry.view().get_listing_seller_hex(prompt_id)  # authoritative seller
            |   (all three read SYNCHRONOUSLY from the Registry — the caller
            |    cannot supply seller or price)
            |
            +-> guard: buyer != seller
            +-> guard: not already purchased (O(1) flag lookup)
            |
            +-> gl.chain.Account(seller).emit_transfer(value = price - 2.5% fee)
            +-> registry.emit(on='finalized').record_purchase(buyer_hex, prompt_id)
                  |
                  +-> writes purchaser receipt   (gates content delivery)
                  +-> increments registry sales_count
            |
            v
         Purchase recorded on Escrow; receipt + sales count recorded on
         Registry. A UserError anywhere rolls back BOTH local state and the
         queued outbound messages, so settlement is atomic.

Buyer -> PromptRegistry.get_purchased_body(prompt_id)   [read; from = buyer]
            |
            +-> caller == seller?                 -> return body
            +-> receipt exists for (caller, id)?  -> return body
            +-> otherwise                         -> UserError (rejected)
```

## Settlement is atomic and registry-verified

`buy()` performs every validation **before** mutating any state or queuing any
outbound message:

1. Read authoritative `status`, `price_wei`, and `seller` from the Registry via
   a synchronous `registry.view()` call. The buyer no longer passes these in, so
   there is nothing to spoof.
2. Require `status == "active"`, `msg.value == price_wei`, a non-empty seller,
   `buyer != seller`, and no prior purchase (O(1) composite-key lookup).
3. Only after all checks pass: write the local purchase record, push the
   seller's proceeds with `emit_transfer`, and emit a single Registry message
   `record_purchase(buyer_hex, prompt_id)`.

Because a `gl.vm.UserError` triggers a full rollback of local storage writes
**and** the queued `emit_transfer` / `record_purchase` messages, money and
receipts always move together or not at all.

## Purchaser-gated content delivery

The prompt body is stored on-chain in `PromptRegistry.body_of` (up to 16,000
chars). It is delivered by `get_purchased_body(prompt_id)`, which returns the
body only to:

- the **seller** of the listing, or
- a wallet holding a **purchase receipt** (`purchased_flag["<buyer>:<id>"]`),
  written exclusively by the Escrow during a settled `buy()`.

Every other caller receives a `UserError`. The receipt check is a **local O(1)
lookup** — content delivery never depends on a cross-contract call at read time,
so it cannot fail on a proxy view.

### Honest threat model

On Bradbury Phase 1, the `from` address on a read (`gen_call` of type `read`) is
supplied by the caller and is **not authenticated**. `get_purchased_body` is
therefore an **application-layer access control**, not cryptographic proof of
payment: it reliably gates the normal UI flow and is exactly as strong as the
receipt written by a real, paid settlement — but a determined caller who crafts
a raw read with a spoofed `from` could read a body they did not pay for. We do
not overstate this. The body hash and preview remain public; the receipt and
sales count (which *do* require a real on-chain payment to write) are the
trustworthy records.

## Why each contract is GenLayer-native

| Contract       | Intelligent / native primitive used                                  |
|----------------|----------------------------------------------------------------------|
| PromptRegistry | `gl.eq_principle.strict_eq` ×2 (duplicate detection + categorization) via `gl.nondet.exec_prompt`; on-chain body storage; gated delivery |
| PromptEscrow   | Deterministic settlement; synchronous cross-contract `view()` reads; atomic `emit_transfer` + `emit().record_purchase()` |

The Registry uses LLM-in-contract as load-bearing logic: every `list_prompt`
runs two validator-consensus rounds (duplicate check, then categorization)
before a listing is accepted. Payments are intentionally deterministic — no LLM
is involved in moving money.

## Storage layout (composite keys, no O(n) scans)

Both contracts avoid per-call linear scans by using flat composite string keys:

- **Escrow** `purchased_flag["<buyer_hex>:<prompt_id>"] -> bool` for the O(1)
  double-buy guard, plus `buyer_count["<buyer_hex>"]` and
  `buyer_item["<buyer_hex>:<index>"]` for an O(k) per-buyer purchase index.
- **Registry** `purchased_flag["<buyer_hex>:<prompt_id>"] -> bool` for the O(1)
  content gate.

## Cross-contract boundary constraint

The current GenVM schema extractor does not reliably handle `Address` or `bool`
as cross-contract view **return** types. The Escrow's `PromptRegistryProxy`
therefore crosses only `str` / `u256`: the seller is carried as a hex string
(`get_listing_seller_hex`) and reconstructed with `Address(seller_hex)` on the
Escrow side. The helper views consumed by the proxy never raise — they return
sentinels (`""`, `0`, `"none"`) — because a revert inside them would revert the
whole `buy()`.
