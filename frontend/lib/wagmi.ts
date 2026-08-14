'use client';

// Contract constants. (Historically this file configured wagmi/RainbowKit; the
// wallet layer is now a custom EIP-6963 provider in lib/wallet.tsx, so only the
// contract addresses live here. Filename kept to avoid churn in importers.)

// v0.5.0 contracts (GenLayer Bradbury Testnet, chain id 4221). Deployed
// 2026-08-15; PromptRegistry.set_escrow_contract(ESCROW_ADDRESS) confirmed
// linked (Registry.get_escrow() -> {set: true, address: ESCROW_ADDRESS},
// Escrow.get_registry_address() -> REGISTRY_ADDRESS).
//   Registry: stores the prompt body encrypted on-chain (body_ciphertext_of)
//     and gates delivery via claim_body -- a signed write, not a read, so it
//     can't be spoofed the way the old get_purchased_body read could.
//   Escrow:   reads seller/price/status authoritatively from the Registry,
//     and on settlement emits record_purchase (on='accepted') to write the
//     receipt + bump the registry sales count.
//
// This pair supersedes the first v0.5.0 deployment
// (Registry 0x2236...8dBe1 / Escrow 0x90Fe...24Cc9), which was abandoned
// because its record_purchase used the on='finalized' default -- buyers
// couldn't unlock until Bradbury's appeal window closed (>35 min observed).
// set_escrow_contract is one-time per Registry, so fixing that required
// redeploying the pair rather than just the Escrow.
export const REGISTRY_ADDRESS = '0x4F748Ba4D0C4756248cc8265EBD540f6851E99f1' as `0x${string}`;
export const ESCROW_ADDRESS = '0x749E877C67748D0fF50a7e06Cf325c7Ee628482e' as `0x${string}`;
