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
| PromptRegistry v0.4.0 | `0x254614E13BFC0772e8367Bce3674820a0Ece4CA0` | Listings, LLM auto-categorization, duplicate detection, on-chain prompt body, purchaser-gated delivery |
| PromptEscrow v0.4.0 | `0x99bb2e9d5A4e3babdbd3158e5CAb0c0C1fABA04c` | Registry-verified payable purchases, seller payouts, atomic settlement, double-buy prevention |

## Features

- **LLM-validated listings** -- every `list_prompt` triggers on-chain LLM
  consensus for auto-categorization (13 categories) via `gl.eq_principle.strict_eq`
- **Duplicate detection** -- validators compare new listings against existing
  ones via LLM; substantively duplicate prompts are auto-rejected on-chain
- **Deterministic tags** -- extracted from listing text in Python, no consensus
  overhead
- **On-chain prompt body** -- the full prompt (up to 16k chars) is stored in the
  Registry, not just a hash or preview
- **Purchaser-gated delivery** -- `get_purchased_body(prompt_id)` returns the
  full prompt only to the seller or a wallet holding an on-chain purchase
  receipt; everyone else is rejected
- **Registry-verified settlement** -- `buy(prompt_id)` reads the authoritative
  seller, price, and active status directly from the Registry; the caller cannot
  supply them
- **Atomic dual-contract settlement** -- a single `buy()` pays the seller, holds
  the 2.5% fee, and writes the purchase receipt + increments the sales count on
  the Registry, all-or-nothing
- **Native GEN payments** -- 97.5% forwarded to the seller immediately via
  the seller's EOA proxy `emit_transfer` (`gl.evm.contract_interface`), 2.5%
  platform fee
- **Double-buy prevention** -- O(1) guard; `buy()` reverts if the buyer already
  owns the prompt
- **My Library** -- buyers see and read every prompt they own at `/library`,
  with the full unlocked body, copy button, and clear loading/empty/error states
- **Humanized error handling** -- UNDETERMINED, VALIDATORS_TIMEOUT, duplicates,
  not-authorized, and wallet errors are translated into actionable feedback
- **Any EVM wallet** -- OKX, MetaMask, or anything WalletConnect-compatible

## How content is gated

1. On `list_prompt`, the Registry stores the full prompt body on-chain
   (`body_of`) alongside its public `body_hash` and short `preview`.
2. On `buy(prompt_id)`, the Escrow verifies the listing against the Registry,
   settles payment, and emits `record_purchase(buyer_hex, prompt_id)` to the
   Registry. That single call writes a **purchase receipt**
   (`purchased_flag["<buyer>:<id>"] = True`) and increments the Registry sales
   count. Receipt and sales count therefore only ever move on a real, paid
   purchase, atomically.
3. In **My Library**, the frontend calls `get_purchased_body(prompt_id)` with
   the connected wallet as the read's `from`. The Registry returns the body only
   to the seller or a receipt holder; any other caller gets a clear
   `not authorized` error.

**Honest threat model.** On Bradbury Phase 1 the `from` address of a read is
caller-supplied and unauthenticated, so `get_purchased_body` is an
application-layer access control, not cryptographic proof of payment. It gates
the normal UI flow reliably and is exactly as strong as the receipt written by a
real settlement -- but a caller crafting a raw read with a spoofed `from` could
read a body they did not pay for. The receipt and sales count (which require an
actual on-chain payment to write) are the trustworthy records. Encryption-based
delivery is a natural future hardening step, but is deliberately **not** claimed
here as already implemented.

## Structure

```
contracts/   Intelligent Contracts (Python, GenVM)
  PromptRegistry.py   Listings, LLM validation, body storage, gated delivery
  PromptEscrow.py     Registry-verified payments + atomic settlement
docs/        Architecture notes
frontend/    Next.js dApp (wagmi + RainbowKit + genlayer-js)
```

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. Contract addresses and chain config are in
`frontend/lib/wagmi.ts`.

## Deploying / migrating (v0.4.0)

The Escrow constructor now takes the Registry address, and the Registry must be
told which Escrow may settle purchases. Deploy in this order:

1. **Deploy `PromptRegistry`** (no constructor args). Note its address `R`.
2. **Deploy `PromptEscrow(platform_fee_bps=250, registry_address=R)`**. Note its
   address `E`. (`250` bps = 2.5%; the constructor rejects anything above 2000.)
3. **Call `PromptRegistry.set_escrow_contract(E)`** from the Registry owner. This
   is one-time and authorizes `E` to call `record_purchase` / `increment_sales`.
4. **Update addresses** in `frontend/lib/wagmi.ts` (`REGISTRY_ADDRESS = R`,
   `ESCROW_ADDRESS = E`) and in the table above.

Existing listings from the previous deployment are not migrated (bodies were not
stored on-chain before v0.4.0); sellers relist on the new Registry so the full
body is captured.

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

- Encryption-based body delivery (e.g. encrypt-to-buyer) to close the
  spoofable-`from` gap once Bradbury exposes authenticated read identity
- QualityOracle contract: dispute resolution by validators re-running the prompt
- ReputationLedger contract: LLM-sanity-checked seller reviews
