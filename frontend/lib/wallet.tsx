'use client';

// Custom EIP-6963 multi-wallet discovery + connection.
//
// Why this exists (and why we dropped wagmi/RainbowKit for signing):
// genlayer-js signs every transaction through `config.provider || window.ethereum`,
// completely bypassing wagmi's connector selection. With several extension wallets
// installed (OKX + MetaMask + Phantom), whichever one won the `window.ethereum`
// slot popped its sign sheet regardless of what the user picked in RainbowKit — so
// "buy" always tried to sign with the wrong wallet.
//
// The fix: enumerate every installed wallet via EIP-6963, let the user pick one
// explicitly, and hand THAT wallet's own provider to genlayer-js's createClient
// (see setActiveProvider in ./genlayer). Each extension announces its own provider
// object over EIP-6963, so the wallet the user clicks is the wallet that signs.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { setActiveProvider } from './genlayer';

// ---- EIP-1193 / EIP-6963 minimal types ----

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

// Bradbury Testnet, chain id 4221 (0x107d).
export const BRADBURY_CHAIN_ID = 4221;
export const BRADBURY_CHAIN_ID_HEX = '0x107d';
const BRADBURY_PARAMS = {
  chainId: BRADBURY_CHAIN_ID_HEX,
  chainName: 'GenLayer Bradbury',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: ['https://rpc-bradbury.genlayer.com/'],
  blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'],
};

const LAST_WALLET_KEY = 'pm.lastWalletRdns';

interface WalletContextValue {
  /** Every installed wallet discovered via EIP-6963, deduped by rdns. */
  wallets: Eip6963ProviderDetail[];
  /** The wallet the user connected (undefined until connected). */
  selected: Eip6963ProviderDetail | null;
  address: `0x${string}` | undefined;
  chainId: number | undefined;
  isConnected: boolean;
  /** True while an eth_requestAccounts / chain switch is in flight. */
  connecting: boolean;
  /** True when connected but not on Bradbury (4221). */
  wrongNetwork: boolean;
  connect: (detail: Eip6963ProviderDetail) => Promise<void>;
  disconnect: () => void;
  switchToBradbury: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within <WalletProvider>');
  return ctx;
}

function hexToNumber(hex: unknown): number | undefined {
  if (typeof hex === 'number') return hex;
  if (typeof hex === 'string' && hex.startsWith('0x')) return parseInt(hex, 16);
  return undefined;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Eip6963ProviderDetail[]>([]);
  const [selected, setSelected] = useState<Eip6963ProviderDetail | null>(null);
  const [address, setAddress] = useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [connecting, setConnecting] = useState(false);

  // Keep a ref to the selected provider so event handlers stay stable.
  const selectedRef = useRef<Eip6963ProviderDetail | null>(null);
  selectedRef.current = selected;

  // ---- EIP-6963 discovery ----
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.rdns || !detail.provider) return;
      setWallets((prev) => {
        if (prev.some((w) => w.info.rdns === detail.info.rdns)) return prev;
        return [...prev, detail];
      });
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce as EventListener);
    // Ask any wallets that are already loaded to re-announce.
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () =>
      window.removeEventListener('eip6963:announceProvider', onAnnounce as EventListener);
  }, []);

  const applyConnection = useCallback(
    (detail: Eip6963ProviderDetail, accounts: string[], cid: number | undefined) => {
      const addr = accounts[0] as `0x${string}` | undefined;
      setSelected(detail);
      setAddress(addr);
      setChainId(cid);
      setActiveProvider(addr ? detail.provider : null);
      if (addr) {
        try {
          window.localStorage.setItem(LAST_WALLET_KEY, detail.info.rdns);
        } catch {
          /* ignore storage errors (private mode, etc.) */
        }
      }
    },
    []
  );

  // ---- Wire provider events for the currently-selected wallet ----
  useEffect(() => {
    const p = selected?.provider;
    if (!p || typeof p.on !== 'function') return;
    const on = p.on.bind(p);
    const onAccounts = (accounts: string[]) => {
      const addr = accounts?.[0] as `0x${string}` | undefined;
      setAddress(addr);
      setActiveProvider(addr ? p : null);
      if (!addr) {
        setSelected(null);
        try {
          window.localStorage.removeItem(LAST_WALLET_KEY);
        } catch {
          /* ignore */
        }
      }
    };
    const onChain = (cid: string) => setChainId(hexToNumber(cid));
    const onDisconnect = () => {
      setSelected(null);
      setAddress(undefined);
      setActiveProvider(null);
    };

    on('accountsChanged', onAccounts);
    on('chainChanged', onChain);
    on('disconnect', onDisconnect);
    return () => {
      p.removeListener?.('accountsChanged', onAccounts);
      p.removeListener?.('chainChanged', onChain);
      p.removeListener?.('disconnect', onDisconnect);
    };
  }, [selected]);

  const switchToBradbury = useCallback(async () => {
    const detail = selectedRef.current;
    if (!detail) return;
    const p = detail.provider;
    try {
      await p.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BRADBURY_CHAIN_ID_HEX }],
      });
    } catch (err: any) {
      // 4902 = chain not added to the wallet yet; add it, then it's active.
      if (err?.code === 4902 || /unrecognized chain|not been added/i.test(err?.message ?? '')) {
        await p.request({ method: 'wallet_addEthereumChain', params: [BRADBURY_PARAMS] });
      } else {
        throw err;
      }
    }
    try {
      const cid = await p.request({ method: 'eth_chainId' });
      setChainId(hexToNumber(cid));
    } catch {
      /* ignore */
    }
  }, []);

  const connect = useCallback(
    async (detail: Eip6963ProviderDetail) => {
      setConnecting(true);
      try {
        const p = detail.provider;
        const accounts = (await p.request({ method: 'eth_requestAccounts' })) as string[];
        let cid = hexToNumber(await p.request({ method: 'eth_chainId' }));
        applyConnection(detail, accounts ?? [], cid);
        // Nudge the wallet onto Bradbury so genlayer-js's assertChainMatch passes
        // when the user goes to sign. Non-fatal if the user declines here.
        if (cid !== BRADBURY_CHAIN_ID) {
          try {
            await switchToBradbury();
          } catch {
            /* user can switch later via the button; leave connected */
          }
        }
      } finally {
        setConnecting(false);
      }
    },
    [applyConnection, switchToBradbury]
  );

  const disconnect = useCallback(() => {
    setSelected(null);
    setAddress(undefined);
    setChainId(undefined);
    setActiveProvider(null);
    try {
      window.localStorage.removeItem(LAST_WALLET_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // ---- Silent reconnect: if a wallet we used before is present and already
  // authorized, restore the session without prompting. ----
  const reconnectedRef = useRef(false);
  useEffect(() => {
    if (reconnectedRef.current || selected) return;
    let last: string | null = null;
    try {
      last = window.localStorage.getItem(LAST_WALLET_KEY);
    } catch {
      last = null;
    }
    if (!last) return;
    const detail = wallets.find((w) => w.info.rdns === last);
    if (!detail) return; // wallet not discovered yet; try again when the list grows
    reconnectedRef.current = true;
    (async () => {
      try {
        const accounts = (await detail.provider.request({
          method: 'eth_accounts',
        })) as string[];
        if (accounts && accounts.length > 0) {
          const cid = hexToNumber(await detail.provider.request({ method: 'eth_chainId' }));
          applyConnection(detail, accounts, cid);
        }
      } catch {
        /* ignore — user can connect manually */
      }
    })();
  }, [wallets, selected, applyConnection]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      selected,
      address,
      chainId,
      isConnected: Boolean(address),
      connecting,
      wrongNetwork: Boolean(address) && chainId !== undefined && chainId !== BRADBURY_CHAIN_ID,
      connect,
      disconnect,
      switchToBradbury,
    }),
    [wallets, selected, address, chainId, connecting, connect, disconnect, switchToBradbury]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
