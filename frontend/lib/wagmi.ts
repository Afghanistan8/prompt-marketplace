'use client';

import { http } from 'wagmi';
import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

export const bradburyChain = defineChain({
  id: 4221,
  name: 'GenLayer Bradbury',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-bradbury.genlayer.com/'] },
  },
  blockExplorers: {
    default: { name: 'Bradbury Explorer', url: 'https://explorer-bradbury.genlayer.com' },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: 'Prompt Market',
  projectId: '3202b98cd356ef0b16b42298ca85ebd0',
  chains: [bradburyChain],
  transports: {
    [bradburyChain.id]: http('https://rpc-bradbury.genlayer.com/'),
  },
  ssr: true,
});

// v0.4.0 contracts.
//   Registry: stores the full prompt body on-chain and gates delivery via
//     get_purchased_body (seller or receipt holder only).
//   Escrow:   reads seller/price/status authoritatively from the Registry,
//     and on settlement calls record_purchase to write the receipt + bump
//     the registry sales count atomically.
//
// TODO(redeploy): the addresses below are the previous (v0.3.x) deployment.
// After deploying the v0.4.0 pair (Registry, then Escrow(250, registry),
// then Registry.set_escrow_contract(escrow)), replace BOTH values.
export const REGISTRY_ADDRESS = '0xcD9976765178b4fFb1B80A3bC90b4B69828dd303' as `0x${string}`;
export const ESCROW_ADDRESS = '0xa6644845B1a136e9CfB48e05C16bcb684D6C93B0' as `0x${string}`;
