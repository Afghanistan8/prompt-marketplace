'use client';

import { http } from 'wagmi';
import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

// ---------- Chain config (public, hardcoded for build-time safety) ----------

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

// ---------- Wagmi + RainbowKit config ----------
// WalletConnect projectId is hardcoded because:
//   1. It's public — it gets inlined into the browser bundle anyway
//   2. Hardcoding avoids RainbowKit's strict projectId check failing during
//      Next.js prerendering of /_not-found (RainbowKit issue #2260)
// Contract addresses are hardcoded for the same reason — they're on-chain
// and publicly known, and keeping them out of env vars makes Vercel
// deployments more reliable.

export const wagmiConfig = getDefaultConfig({
  appName: 'Prompt Market',
  projectId: '3202b98cd356ef0b16b42298ca85ebd0',
  chains: [bradburyChain],
  transports: {
    [bradburyChain.id]: http('https://rpc-bradbury.genlayer.com/'),
  },
  ssr: true,
});

// ---------- Contract addresses ----------

export const REGISTRY_ADDRESS = '0xDcb0c7210B520379C91Ea97967DB920984bf3Ac1' as `0x${string}`;
export const ESCROW_ADDRESS = '0xc3DfF0Ed88A8912d992D96bb4b6e44383bF90431' as `0x${string}`;
