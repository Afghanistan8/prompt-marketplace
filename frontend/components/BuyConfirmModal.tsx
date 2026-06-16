'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { X, Loader2, CheckCircle2, AlertCircle, ShoppingBag } from 'lucide-react';
import {
  buyPrompt,
  waitForTx,
  formatGen,
  shortAddress,
  invalidateCache,
  type ActiveListing,
} from '../lib/genlayer';

type Stage = 'idle' | 'signing' | 'waiting' | 'success' | 'error';

interface Props {
  open: boolean;
  listing: ActiveListing | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function BuyConfirmModal({ open, listing, onClose, onSuccess }: Props) {
  const { address, isConnected } = useAccount();
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!open || !listing) return null;

  function reset() {
    setStage('idle');
    setErrorMsg(null);
    setTxHash(null);
  }

  async function handleBuy() {
    if (!listing) return;
    setErrorMsg(null);

    if (!isConnected || !address) {
      setErrorMsg('Connect your wallet first.');
      return;
    }
    if (address.toLowerCase() === listing.seller.toLowerCase()) {
      setErrorMsg("You can't buy your own listing.");
      return;
    }

    try {
      setStage('signing');
      const { hash } = await buyPrompt(
        listing.id,
        listing.seller as `0x${string}`,
        listing.price_wei,
        address as `0x${string}`
      );
      setTxHash(hash);

      setStage('waiting');
      await waitForTx(hash, address as `0x${string}`);

      setStage('success');
      invalidateCache('escrow_sales');
      invalidateCache('has_purchased');
      invalidateCache('buyer_purchases');
      invalidateCache('escrow_stats');
      onSuccess();
    } catch (e) {
      console.error('[Buy] error:', e);
      setStage('error');
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object'
          ? JSON.stringify(e, null, 2)
          : String(e);
      setErrorMsg(msg);
    }
  }

  const isSubmitting = stage === 'signing' || stage === 'waiting';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-semibold">Confirm purchase</h2>
          </div>
          <button
            onClick={() => {
              if (isSubmitting) return;
              onClose();
              if (stage === 'success') reset();
            }}
            disabled={isSubmitting}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {stage === 'success' ? (
            <SuccessView txHash={txHash} onDone={() => { onClose(); reset(); }} />
          ) : (
            <>
              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <Row label="Listing">
                  <span className="font-medium text-zinc-100">{listing.title}</span>
                </Row>
                <Row label="Category">
                  <span className="text-xs uppercase tracking-wide text-purple-300">
                    {listing.category}
                  </span>
                </Row>
                <Row label="Seller">
                  <span className="font-mono text-xs text-zinc-300">{shortAddress(listing.seller)}</span>
                </Row>
                <div className="border-t border-zinc-800 pt-3">
                  <Row label={<span className="font-medium text-zinc-300">Total</span>}>
                    <span className="text-lg font-semibold text-purple-300">
                      {formatGen(listing.price_wei)} GEN
                    </span>
                  </Row>
                </div>
              </div>

              <p className="mt-4 text-xs text-zinc-500">
                The seller receives {formatGen((listing.price_wei * 9750n) / 10000n)} GEN immediately.
                Platform fee: 2.5%.
              </p>

              {errorMsg && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">{errorMsg}</span>
                </div>
              )}

              {isSubmitting && (
                <div className="mt-4 flex items-center gap-2 rounded-md border border-purple-500/20 bg-purple-500/5 p-3 text-sm text-purple-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {stage === 'signing' && 'Approve the transaction in your wallet…'}
                    {stage === 'waiting' && 'Submitting purchase on Bradbury (~30–90s)…'}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {stage !== 'success' && (
          <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-6 py-4">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBuy}
              disabled={isSubmitting || !isConnected}
              className="flex items-center gap-1.5 rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-400 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Buy for {formatGen(listing.price_wei)} GEN
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-zinc-500">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

function SuccessView({ txHash, onDone }: { txHash: string | null; onDone: () => void }) {
  return (
    <div className="py-4 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
      <h3 className="mt-3 text-base font-medium">Purchase complete</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Seller paid, sale recorded on-chain.
      </p>
      {txHash && (
        <a
          href={`https://explorer-bradbury.genlayer.com/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs text-purple-400 hover:text-purple-300"
        >
          View transaction →
        </a>
      )}
      <div className="mt-5">
        <button
          onClick={onDone}
          className="rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-400"
        >
          Done
        </button>
      </div>
    </div>
  );
}
