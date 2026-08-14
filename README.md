# Prompt Market

**The first prompt marketplace where the chain itself judges quality _and_ delivers the goods.**

Listings are auto-categorized, duplicates are auto-rejected, payments settle
on-chain, and the purchased prompt is delivered straight from the contract to
verified buyers -- all validated by GenLayer Bradbury LLM consensus, not a
centralized backend API.

**Live dApp:** https://prompt-marketplace-v5s1.vercel.app/
**How it works:** https://prompt-marketplace-v5s1.vercel.app/how-it-works

## Contracts (GenLayer Bradbury Testnet, chain id 4221)

| Contract | Address | Role |
|---|---|---|
| PromptRegistry v0.5.0 | `0x4F748Ba4D0C4756248cc8265EBD540f6851E99f1` | Listings, LLM auto-categorization, duplicate detection, encrypted on-chain prompt body, authenticated receipt-gated delivery |
| PromptEscrow v0.5.0 | `0x749E877C67748D0fF50a7e06Cf325c7Ee628482e` | Registry-verified payable purchases, seller payouts, atomic settlement, double-buy prevention |

## Features

- **LLM-validated listings** -- every `list_prompt` triggers on-chain LLM
  consensus for auto-categorization (13 categories) via `gl.eq_principle.strict_eq`
- **Duplicate detection** -- validators compare new listings against existing
  ones via LLM; substantively duplicate prompts are auto-rejected on-chain
- **Deterministic tags** -- extracted from listing text in Python, no consensus
  overhead
- **On-chain prompt body, encrypted at rest** -- the full prompt (up to 16k
  chars) is stored in the Registry, not just a hash or preview -- but as
  ciphertext. `body_of` is gone; no field, and no getter, ever holds
  plaintext.
- **Authenticated, receipt-gated delivery** -- `claim_body(prompt_id)` is a
  signed write, not a read. GenVM derives its caller from the transaction's
  real signature, not a caller-supplied parameter, so it decrypts and returns
  the body only to the seller or a wallet holding an on-chain purchase
  receipt; everyone else gets a UserError -- and there is no read path, gated
  or not, that returns the body at all
- **Registry-verified settlement** -- `buy(prompt_id)` reads the authoritative
  seller, price, and active status directly from the Registry; the caller cannot
  supply them
- **Atomic dual-contract settlement** -- a single `buy()` pays the seller, holds
  the 2.5% fee, and writes the purchase receipt + increments the sales count on
  the Registry, all-or-nothing. The receipt is emitted `on='accepted'` so buyers
  can unlock ~30-90s after paying rather than waiting out the appeal window;
  `record_purchase` is idempotent to stay safe under message re-delivery
- **Native GEN payments** -- 97.5% forwarded to the seller immediately via
  the seller's EOA proxy `emit_transfer` (`gl.evm.contract_interface`), 2.5%
  platform fee
- **Double-buy prevention** -- O(1) guard; `buy()` reverts if the buyer already
  owns the prompt
- **My Library** -- buyers see every prompt they own at `/library` and unlock
  each one with a single signed `claim_body` transaction; copy button and
  clear signing/waiting/finalizing/error states throughout
- **Humanized error handling** -- UNDETERMINED, VALIDATORS_TIMEOUT, duplicates,
  not-authorized, and wallet errors are translated into actionable feedback
- **Any EVM wallet** -- OKX, MetaMask, or anything WalletConnect-compatible

## How content is gated

**The steward feedback that drove v0.5.0:** "full prompt delivery is still
bypassable because Bradbury read `from` can be spoofed and the body is stored
in plaintext." Both halves of that are fixed:

1. On `list_prompt`, the Registry **encrypts** the body immediately and
   stores only ciphertext (`body_ciphertext_of`). The plaintext body is never
   assigned to any contract field. There is no `body_of`, and no getter
   anywhere returns raw body content -- `get_listing` and every other view
   omit it entirely.
2. On `buy(prompt_id)`, the Escrow verifies the listing against the Registry,
   settles payment, and emits `record_purchase(buyer_hex, prompt_id)` to the
   Registry. That single call writes a **purchase receipt**
   (`purchased_flag["<buyer>:<id>"] = True`) and increments the Registry sales
   count. Receipt and sales count therefore only ever move on a real, paid
   purchase, atomically.
3. In **My Library**, the frontend calls `claim_body(prompt_id)` -- a
   `@gl.public.write`, not a read. The buyer signs it with their wallet, GenVM
   derives the caller from that real transaction signature, and only then does
   the Registry check seller-or-receipt and decrypt. The decrypted body comes
   back as the write's own return value. Anyone else -- including a raw read
   with `from` forged to a real purchaser's address -- gets nothing, because
   there is no read path left that touches body content at all.

**Threat model.** On Bradbury Phase 1 a read's `from` is still caller-supplied
and unauthenticated -- that hasn't changed and can't be changed from contract
code. What changed is that content delivery no longer goes through a read at
all. A write's `gl.message.sender_address` is derived from a real,
validator-verified signature over the submitted transaction (see
`genlayer-js`: reads issue an unauthenticated `gen_call`, writes are signed
via `account.signTransaction` before broadcast), so `claim_body` cannot be
spoofed the way `get_purchased_body` could. Be precise about the at-rest
cipher too: because the contract itself has to decrypt (to serve
`claim_body`), its confidentiality rests on the per-contract vault secret
never being exposed by any getter -- the same trust boundary as any "private"
contract field, not an independent secret unknown to the contract. The actual
cryptographic authentication boundary is the write's signature, not the
cipher; `contracts/tests/test_claim_body_security.py` proves the resulting
property directly against the real contract source: no view, under any
sender, ever returns the body, and `claim_body` only ever returns it to the
seller or a real receipt holder.

## Structure

```
contracts/   Intelligent Contracts (Python, GenVM)
  PromptRegistry.py   Listings, LLM validation, encrypted body storage, authenticated delivery
  PromptEscrow.py     Registry-verified payments + atomic settlement
  tests/              Proof that unpaid/spoofed callers can't recover the body (see below)
docs/        Architecture notes
frontend/    Next.js dApp (custom EIP-6963 wallet layer + genlayer-js)
```

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Contract addresses and chain config are in
`frontend/lib/wagmi.ts`.

## Testing

```bash
python -m pytest contracts/tests/ -v
```

`contracts/tests/test_claim_body_security.py` runs the actual
`contracts/PromptRegistry.py` source (not a reimplementation) against a
minimal stand-in for the GenVM `genlayer` SDK, and proves:

- the plaintext body is never assigned to any contract field (only ciphertext is)
- `record_purchase` is idempotent, so the `on='accepted'` receipt emission
  cannot double-count sales if GenLayer re-delivers it across appeal rounds
- **every** `@gl.public.view` the Registry exposes is called with a real
  purchaser's address as the (spoofed) sender, and none of them ever return
  the body -- this is the steward's exact "raw read... supplying a
  purchaser's address" scenario
- `claim_body` returns the correct body to the seller and to a wallet with a
  real purchase receipt, and raises for everyone else, including a caller who
  never paid
- the vulnerable `get_purchased_body` / `get_body` methods no longer exist at all

See `contracts/tests/_genlayer_stub.py`'s module docstring for the one thing a
contract-level test like this cannot prove by itself: that GenVM's write
sender is a real, signature-verified value. That guarantee lives in the chain
layer (confirmed against `genlayer-js`'s source: reads issue an
unauthenticated `gen_call`, writes are signed via `account.signTransaction`),
outside what a Python unit test can exercise -- the test proves the contract
logic built on top of that guarantee is correct.

## Deploying / migrating (v0.5.0)

The `PromptRegistry` ABI and storage layout changed in v0.5.0 (`body_of` ->
`body_ciphertext_of`, `get_purchased_body` removed, `claim_body` added), so it
needs a fresh deployment; `PromptEscrow` is unchanged but was version-bumped
alongside it. The Escrow constructor takes the Registry address, and the
Registry must be told which Escrow may settle purchases. Deploy in this order:

1. **Deploy `PromptRegistry`** (no constructor args). Note its address `R`.
2. **Deploy `PromptEscrow(platform_fee_bps=250, registry_address=R)`**. Note its
   address `E`. (`250` bps = 2.5%; the constructor rejects anything above 2000.)
3. **Call `PromptRegistry.set_escrow_contract(E)`** from the Registry owner. This
   is one-time and authorizes `E` to call `record_purchase` / `increment_sales`.
4. **Update addresses** in `frontend/lib/wagmi.ts` (`REGISTRY_ADDRESS = R`,
   `ESCROW_ADDRESS = E`) and in the table above.

Existing listings from the previous deployment are not migrated (each listing's
encryption key is derived from the deploying Registry's own internal vault
secret, so ciphertext from the old Registry isn't decryptable by a new one
regardless); sellers relist on the new Registry.

## Tech notes

- Consensus design: the LLM returns only a constrained enum choice (category),
  so validators converge first-round. Open-ended outputs (tags) are computed
  deterministically instead.
- Payments use a push-payment pattern: sellers are paid inside the same
  transaction as the buy. Platform fees accumulate for owner withdrawal.
- No O(n) scans: double-buy prevention, per-buyer purchase lists, and the
  content gate all use flat composite-key TreeMaps (O(1) / O(k)).
- Cross-contract boundary: the Escrow's `PromptRegistryProxy` crosses only
  `str` / `u256` (the current schema extractor does not reliably handle
  `Address` / `bool` return types), so the seller is carried as a hex string.

## Roadmap

- QualityOracle contract: dispute resolution by validators re-running the prompt
- ReputationLedger contract: LLM-sanity-checked seller reviews
