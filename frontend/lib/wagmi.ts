'use client';

// Contract constants. (Historically this file configured wagmi/RainbowKit; the
// wallet layer is now a custom EIP-6963 provider in lib/wallet.tsx, so only the
// contract addresses live here. Filename kept to avoid churn in importers.)

// v0.4.0 contracts (GenLayer Bradbury Testnet, chain id 4221).
//   Registry: stores the full prompt body on-chain and gates delivery via
//     get_purchased_body (seller or receipt holder only).
//   Escrow:   reads seller/price/status authoritatively from the Registry,
//     and on settlement calls record_purchase to write the receipt + bump
//     the registry sales count atomically.
export const REGISTRY_ADDRESS = '0x26e4c580eC2D2D388a810334Ed2A111208c3c906' as `0x${string}`;
export const ESCROW_ADDRESS = '0xB1001732103264822F775E25CFebE2BB80D0b3ea' as `0x${string}`;
