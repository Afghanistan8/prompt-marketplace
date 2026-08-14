# Architecture Notes

Two intelligent contracts on GenLayer Bradbury Testnet (chain id 4221). The
Registry owns listings, LLM validation, the encrypted prompt body, and
authenticated content delivery. The Escrow owns payment and settlement. There
is **no off-chain backend** in the core path — gating logic lives in the
contracts.

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
            +-> EthAccount(seller).emit_transfer(value = price - 2.5% fee)  # external msg -> on='finalized' (forced)
            +-> registry.emit(on='accepted').record_purchase(buyer_hex, prompt_id)
                  |                          # internal msg -> may fire at acceptance
                  +-> writes purchaser receipt   (gates content delivery)
                  +-> increments registry sales_count  (idempotent; see below)
            |
            v
         Purchase recorded on Escrow; receipt + sales count recorded on
         Registry. A UserError anywhere rolls back BOTH local state and the
         queued outbound messages, so settlement is atomic.

Buyer -> PromptRegistry.claim_body(prompt_id)   [write; buyer signs the tx]
            |
            +-> GenVM derives sender from the transaction signature -- not
            |   caller-supplied, unlike a read's `from`
            +-> caller == seller?                 -> decrypt + return body
            +-> receipt exists for (caller, id)?  -> decrypt + return body
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

### Message timing: why the receipt fires `on='accepted'`

GenLayer emitted messages default to `on='finalized'` — they execute only
after the emitting transaction's appeal window closes. That default is wrong
for the purchase receipt: on Bradbury Phase 1 finalization was observed taking
well over 35 minutes, and since `claim_body` gates on the receipt, a buyer who
had genuinely paid could not unlock their prompt for that entire window. The
purchase looked broken when it was merely un-finalized.

`record_purchase` is an **internal** message (contract → contract), so it is
eligible for `on='accepted'` and now uses it: the receipt lands once initial
consensus accepts the `buy()`, ~30–90s. The seller payout is an **external**
message (contract → EOA), which GenLayer only permits `on='finalized'`, so it
necessarily still waits for the appeal window.

The documented cost of `on='accepted'` is that a message may be re-delivered
across appeal rounds and cannot be recalled, so the receiver must be
idempotent. `PromptRegistry.record_purchase` is written accordingly — it
returns early if the receipt already exists, so repeat delivery cannot inflate
`sales_count`. `contracts/tests/test_claim_body_security.py::test_record_purchase_is_idempotent`
pins that behavior.

## Encrypted-at-rest content, authenticated delivery

**Steward feedback that drove this design (v0.5.0):** "full prompt delivery is
still bypassable because Bradbury read `from` can be spoofed and the body is
stored in plaintext." Two independent problems, two independent fixes:

**1. Plaintext never touches state.** `list_prompt` encrypts the body before
storing it, in `PromptRegistry.body_ciphertext_of` (up to 16,000 chars of
plaintext, stored as hex ciphertext). There is no `body_of` field. The cipher
is a dependency-free SHA-256 counter-mode keystream (`_encrypt_body` /
`_decrypt_body` / `_keystream` / `_derive_body_key`), keyed per-listing from
`vault_secret_hex` — a secret generated once at contract construction and
exposed by **no getter, anywhere**.

Be precise about what that buys you: the contract itself must be able to
decrypt (to serve `claim_body`), so the cipher's confidentiality rests
entirely on `vault_secret_hex` never being returned by any method — the same
trust boundary as any "private" field on any smart-contract platform, not an
independent secret unknown to the contract. It is defense-in-depth (no getter,
present or future, can leak plaintext by returning a stored field) layered on
top of the real fix below, not a replacement for it.

**2. Delivery moved from a read to a write.** `get_purchased_body` (a
`@gl.public.view`) is removed entirely — there is no read path left that
returns body content, gated or not. In its place, `claim_body(prompt_id)` is a
`@gl.public.write`:

- the **seller** of the listing, or
- a wallet holding a **purchase receipt** (`purchased_flag["<buyer>:<id>"]`),
  written exclusively by the Escrow during a settled `buy()`,

...gets the body decrypted and returned as the write's own return value.
Every other caller receives a `UserError` and nothing else. The receipt check
is still a **local O(1) lookup** — content delivery never depends on a
cross-contract call, so it cannot fail on a proxy view.

### Why the write closes the read-spoofing hole

On Bradbury Phase 1, the `from` address on a read (`gen_call` of type `read`)
is supplied by the caller and is **not authenticated** — that has not changed
and is not something contract code can change. What changed is that content
delivery no longer goes through a read. A `@gl.public.write`'s
`gl.message.sender_address` is derived by GenVM from a real,
validator-verified **signature** over the submitted transaction: confirmed
against `frontend/node_modules/genlayer-js`'s source, reads dispatch an
unauthenticated `gen_call` RPC with a caller-supplied `from` param, while
writes build calldata and then sign it (`account.signTransaction`) before
broadcasting via `eth_sendTransaction`. An attacker who hands `claim_body`
a real purchaser's address as the argument gains nothing — `sender_address`
isn't an argument, it's derived from whichever key actually signed the
transaction, and the attacker cannot produce a valid signature for a key they
don't hold.

`contracts/tests/test_claim_body_security.py` proves the contract-side half of
this directly against the real `PromptRegistry.py` source: every declared
`@gl.public.view` is called with a real purchaser's address handed to it as
the (spoofable) sender, and none of them ever return the body, because none
of them touch body content at all. See that test file, and
`contracts/tests/_genlayer_stub.py`'s module docstring, for the precise
boundary of what a contract-level unit test can and cannot prove — signature
verification itself lives in the GenVM/chain layer, external to contract
code, so no unit test (this one included) simulates it; what the test proves
is that the authorization logic built on top of that guarantee is correct.

The body hash and preview remain public, same as before. The receipt and
sales count (which require a real on-chain payment to write) remain the
trustworthy settlement records.

## Why each contract is GenLayer-native

| Contract       | Intelligent / native primitive used                                  |
|----------------|----------------------------------------------------------------------|
| PromptRegistry | `gl.eq_principle.strict_eq` ×2 (duplicate detection + categorization) via `gl.nondet.exec_prompt`; encrypted on-chain body storage; authenticated `claim_body` delivery |
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
