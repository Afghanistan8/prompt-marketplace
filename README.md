# AI Prompt Marketplace

The first prompt marketplace where the chain itself judges quality.

Built on GenLayer. Listings are auto-categorized, duplicates are auto-rejected,
and disputes are resolved by GenLayer Bradbury on-chain LLM consensus.

## Contracts (Bradbury testnet)

- **PromptRegistry** ? `0xDcb0c7210B520379C91Ea97967DB920984bf3Ac1`
- **PromptEscrow**   ? `0xc3DfF0Ed88A8912d992D96bb4b6e44383bF90431`

## Structure

- `contracts/` ? Intelligent Contracts (Python)
- `frontend/` ? Next.js dApp

## Run frontend locally

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:3000.

Requires a `.env.local` in `frontend/` with `NEXT_PUBLIC_REGISTRY_ADDRESS`,
`NEXT_PUBLIC_ESCROW_ADDRESS`, and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
