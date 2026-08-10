'use client';

import { ReactNode } from 'react';
import { WalletProvider } from './wallet';

// v0.4.0 wallet stack: a custom EIP-6963 provider (lib/wallet.tsx) replaces
// wagmi + RainbowKit. genlayer-js signs through the exact provider the user
// picks, so the right wallet always signs even with several extensions installed.
export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
