'use client';

import { http } from 'wagmi';
import { createConfig } from 'wagmi';
import { defineChain } from 'viem';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  rabbyWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';

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

const WALLETCONNECT_PROJECT_ID = '3202b98cd356ef0b16b42298ca85ebd0';

// We deliberately do NOT use RainbowKit's getDefaultConfig here.
//
// getDefaultConfig lumps browser-extension wallets behind a single shared
// injected provider, so picking "OKX" in the modal could hand the request to
// whatever injected provider won the race (MetaMask / Phantom) and the wrong
// wallet popped its sign sheet. Building the connector list explicitly with
// connectorsForWallets gives each extension its own EIP-6963 provider, so the
// wallet the user actually clicks is the one that signs. This mirrors the
// working setup in the GenLayer DEX Aggregator app.
const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      wallets: [
        okxWallet,
        metaMaskWallet,
        phantomWallet,
        rabbyWallet,
        walletConnectWallet,
        injectedWallet,
      ],
    },
  ],
  { appName: 'Prompt Market', projectId: WALLETCONNECT_PROJECT_ID }
);

export const wagmiConfig = createConfig({
  connectors,
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
