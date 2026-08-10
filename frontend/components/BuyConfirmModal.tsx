'use client';

import { useState } from 'react';
import { useWallet } from '../lib/wallet';
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

function humanizeError(raw: string): { message: string; hint: string | null } {
  const s = raw.toLowerCase();
  if (s.includes('already purchased')) {
    return {
      message: 'You already own this prompt.',
      hint: 'Check "My library" from the header to view it.',
    };
  }
  if (s.includes('listing is not active')) {
    return {
      message: 'This listing was deactivated by the seller.',
      hint: 'Try refreshing the marketplace to see current listings.',
    };
  }
  if (s.includes('price does not match') || s.includes('attached value does not match')) {
    return {
      message: 'Payment amount did not match the current listing price.',
      hint: 'Refresh and try again in case the listing was updated.',
    };
  }
  if (s.includes('seller does not match')) {
    return {
      message: 'The seller on record has changed for this listing.',
      hint: 'Refresh the marketplace and try again.',
    };
  }
  if (s.includes('undetermined')) {
    return {
      message: 'Validators could not reach consensus.',
      hint: 'Bradbury testnet occasionally hits this. Wait a minute and try again.',
    };
  }
  if (s.includes('validators_timeout') || s.includes('validators timeout')) {
    return {
      message: 'Validators timed out reaching consensus.',
      hint: 'This is a Bradbury Phase 1 testnet limitation. Auto-appeal will retry in about 30 min.',
    };
  }
  if (s.includes('timed out waiting')) {
    return {
      message: 'The transaction is taking longer than expected.',
      hint: 'It may still succeed. Check the transaction link and refresh after a minute.',
    };
  }
  if (s.includes('user rejected') || s.includes('user denied')) {
    return { message: 'You cancelled the transaction in your wallet.', hint: null };
  }
  if (s.includes('insufficient funds') || s.includes('insufficient balance')) {
    return {
      message: 'Not enough GEN to complete this purchase.',
      hint: 'You need the listing price plus a small amount for gas.',
    };
  }
  return { message: raw, hint: null };
}

export function BuyConfirmModal({ open, listing, onClose, onSuccess }: Props) {
  const { address, isConnected } = useWallet();
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!open || !listing) return null;

  function reset() {
    setStage('idle');
    setErrorMsg(null);
    setErrorHint(null);
    setTxHash(null);
  }

  async function handleBuy() {
    if (!listing) return;
    setErrorMsg(null);
    setErrorHint(null);

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
      invalidateCache('all_active');
      invalidateCache('listing:');
      invalidateCache('purchased_body:');
      onSuccess();
    } catch (e) {
      console.error('[Buy] error:', e);
      setStage('error');
      const raw =
        e instanceof Error
          ? e.message
          : typeof e === 'object'
          ? JSON.stringify(e)
          : String(e);
      const { message, hint } = humanizeError(raw);
      setErrorMsg(message);
      setErrorHint(hint);
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
              if (stage === 'success' || stage === 'error') reset();
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
                Escrow verifies the seller, price, and active status directly against the Registry contract before accepting payment. The seller receives {formatGen((listing.price_wei * 9750n) / 10000n)} GEN immediately. Platform fee: 2.5%.
              </p>

              {errorMsg && (
                <div className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm">
                  <div className="flex items-start gap-2 text-red-300">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{errorMsg}</span>
                  </div>
                  {errorHint && (
                    <p className="mt-2 pl-6 text-xs text-red-400/80">{errorHint}</p>
                  )}
                </div>
              )}

              {isSubmitting && (
                <div className="mt-4 flex items-center gap-2 rounded-md border border-purple-500/20 bg-purple-500/5 p-3 text-sm text-purple-200">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>
                    {stage === 'signing' && 'Approve the transaction in your wallet...'}
                    {stage === 'waiting' && 'Escrow verifying against Registry + settling on Bradbury (about 30-90s)...'}
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
        Seller paid, sale recorded on both contracts. Check "My library" to view the unlocked prompt.
      </p>
      {txHash && (
        <a
          href={`https://explorer-bradbury.genlayer.com/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs text-purple-400 hover:text-purple-300"
        >
          View transaction &#8594;
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
