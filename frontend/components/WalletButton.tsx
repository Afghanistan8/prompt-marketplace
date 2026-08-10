'use client';

// Wallet connect UI built on our EIP-6963 discovery (lib/wallet.tsx), replacing
// RainbowKit's ConnectButton. It lists EVERY installed wallet by name + icon so
// the user can pick OKX / MetaMask / Phantom / etc. explicitly, and the wallet
// they click is the one that signs (genlayer-js gets that exact provider).

import { useEffect, useRef, useState } from 'react';
import { Wallet, ChevronDown, LogOut, AlertTriangle, Loader2, X } from 'lucide-react';
import { useWallet, type Eip6963ProviderDetail } from '../lib/wallet';
import { shortAddress } from '../lib/genlayer';

export function WalletButton() {
  const {
    wallets,
    address,
    isConnected,
    connecting,
    wrongNetwork,
    connect,
    disconnect,
    switchToBradbury,
    selected,
  } = useWallet();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the connected-state dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  async function handlePick(detail: Eip6963ProviderDetail) {
    setError(null);
    try {
      await connect(detail);
      setPickerOpen(false);
    } catch (e: any) {
      if (e?.code === 4001 || /user rejected|user denied/i.test(e?.message ?? '')) {
        setError('Connection request was rejected in the wallet.');
      } else {
        setError(e?.message ? String(e.message) : 'Could not connect to that wallet.');
      }
    }
  }

  async function handleSwitch() {
    setError(null);
    setSwitching(true);
    try {
      await switchToBradbury();
    } catch (e: any) {
      setError(e?.message ? String(e.message) : 'Could not switch network.');
    } finally {
      setSwitching(false);
    }
  }

  // ---- Connected ----
  if (isConnected && address) {
    return (
      <div className="relative flex items-center gap-2" ref={menuRef}>
        {wrongNetwork && (
          <button
            onClick={handleSwitch}
            disabled={switching}
            className="flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
          >
            {switching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            Switch to Bradbury
          </button>
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-zinc-700 hover:bg-zinc-900"
        >
          {selected?.info.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={selected.info.icon} alt="" className="h-4 w-4 rounded-sm" />
          ) : (
            <Wallet className="h-4 w-4 text-purple-400" />
          )}
          <span className="font-mono text-xs">{shortAddress(address)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
            <div className="border-b border-zinc-800 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                {selected?.info.name ?? 'Connected wallet'}
              </p>
              <p className="mt-0.5 break-all font-mono text-xs text-zinc-300">{address}</p>
            </div>
            <button
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
              className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-100"
            >
              <LogOut className="h-4 w-4" />
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Disconnected ----
  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setPickerOpen(true);
        }}
        className="flex items-center gap-2 rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-400"
      >
        <Wallet className="h-4 w-4" />
        Connect Wallet
      </button>

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
          onClick={() => !connecting && setPickerOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-purple-400" />
                <h2 className="text-base font-semibold">Connect a wallet</h2>
              </div>
              <button
                onClick={() => !connecting && setPickerOpen(false)}
                disabled={connecting}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4">
              {wallets.length === 0 ? (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-400">
                  <p className="font-medium text-zinc-300">No wallet extensions detected</p>
                  <p className="mt-1 text-zinc-500">
                    Install OKX, MetaMask, Phantom, or another EIP-6963 wallet, then reopen this
                    dialog.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {wallets.map((w) => (
                    <li key={w.info.rdns}>
                      <button
                        onClick={() => handlePick(w)}
                        disabled={connecting}
                        className="flex w-full items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-left transition hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60"
                      >
                        {w.info.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={w.info.icon} alt="" className="h-7 w-7 rounded-md" />
                        ) : (
                          <Wallet className="h-7 w-7 text-purple-400" />
                        )}
                        <span className="flex-1 text-sm font-medium text-zinc-100">
                          {w.info.name}
                        </span>
                        {connecting && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {error && (
                <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
                  {error}
                </div>
              )}

              <p className="mt-4 text-[11px] leading-relaxed text-zinc-600">
                Each wallet is discovered via EIP-6963, so the wallet you pick is the one that signs
                — no more MetaMask stealing an OKX transaction. You&apos;ll be asked to approve
                GenLayer Bradbury (chain 4221) on first connect.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
