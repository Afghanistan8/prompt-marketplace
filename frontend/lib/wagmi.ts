'use client';

import { http, createConfig } from 'wagmi';
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
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',
  chains: [bradburyChain],
  transports: {
    [bradburyChain.id]: http('https://rpc-bradbury.genlayer.com/'),
  },
  ssr: true,
});

export const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ||
  '') as `0x${string}`;
export const ESCROW_ADDRESS = (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ||
  '') as `0x${string}`;
