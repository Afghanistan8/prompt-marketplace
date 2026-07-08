# Prompt Market

**The first prompt marketplace where the chain itself judges quality.**

Listings are auto-categorized, duplicates are auto-rejected, and payments settle
on-chain -- all validated by GenLayer Bradbury LLM consensus, not a centralized
backend API.

**Live dApp:** https://prompt-marketplace-v5s1.vercel.app/
**How it works:** https://prompt-marketplace-v5s1.vercel.app/how-it-works

## Contracts (GenLayer Bradbury Testnet)

| Contract | Address | Role |
|---|---|---|
| PromptRegistry | `0xDcb0c7210B520379C91Ea97967DB920984bf3Ac1` | Listings, LLM auto-categorization, duplicate detection |
| PromptEscrow v0.2.1 | `0xa6644845B1a136e9CfB48e05C16bcb684D6C93B0` | Payable purchases, seller payouts, on-chain receipts, double-buy prevention |

## Features

- **LLM-validated listings** -- every `list_prompt` triggers on-chain LLM
  consensus for auto-categorization (13 categories) via `gl.eq_principle.strict_eq`
- **Duplicate detection** -- validators compare new listings against existing
  ones via LLM; substantively duplicate prompts are auto-rejected on-chain
- **Deterministic tags** -- extracted from listing text in Python, no consensus
  overhead
- **Native GEN payments** -- `buy()` is payable; 97.5% forwarded to the seller
  immediately via `gl.chain.Account.emit_transfer`, 2.5% platform fee
- **Double-buy prevention** -- `buy()` reverts if the buyer already owns the
  prompt (v0.2.1)
- **My Library** -- buyers see every prompt they own at `/library`, backed by
  on-chain receipts (`has_purchased`, `get_buyer_purchases`)
- **Humanized error handling** -- UNDETERMINED, VALIDATORS_TIMEOUT, duplicates,
  and wallet errors are translated into actionable feedback
- **Any EVM wallet** -- OKX, MetaMask, or anything WalletConnect-compatible

## Structure

```
contracts/   Intelligent Contracts (Python, GenVM)
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

## Tech notes

- Consensus design: the LLM returns only a constrained enum choice (category),
  so validators converge first-round (`numOfRounds: 0` in production txs).
  Open-ended outputs (tags) are computed deterministically instead.
- Payments use a push-payment pattern: sellers are paid inside the same
  transaction as the buy. Platform fees accumulate for owner withdrawal.
- Purchase receipts (`has_purchased`) are the authorization primitive for
  planned v2 features: Lit Protocol content gating, QualityOracle disputes,
  and ReputationLedger.

## Roadmap (v2)

- Encrypted prompt bodies on IPFS, unlocked via Lit Protocol using on-chain receipts
- QualityOracle contract: dispute resolution by validators re-running the prompt
- ReputationLedger contract: LLM-sanity-checked seller reviews
