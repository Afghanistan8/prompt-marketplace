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

// v0.4.0 contracts (GenLayer Bradbury Testnet, chain id 4221).
//   Registry: stores the full prompt body on-chain and gates delivery via
//     get_purchased_body (seller or receipt holder only).
//   Escrow:   reads seller/price/status authoritatively from the Registry,
//     and on settlement calls record_purchase to write the receipt + bump
//     the registry sales count atomically.
export const REGISTRY_ADDRESS = '0x26e4c580eC2D2D388a810334Ed2A111208c3c906' as `0x${string}`;
export const ESCROW_ADDRESS = '0xB1001732103264822F775E25CFebE2BB80D0b3ea' as `0x${string}`;
