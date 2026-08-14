'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useWallet } from '../../lib/wallet';
import { WalletButton } from '../../components/WalletButton';
import {
  getBuyerPurchases,
  getListing,
  claimBody,
  formatGen,
  shortAddress,
  invalidateCache,
  type Listing,
} from '../../lib/genlayer';
import {
  ArrowLeft,
  BookOpen,
  Loader2,
  RefreshCw,
  Tag,
  Copy,
  Check,
  Lock,
  KeyRound,
  AlertCircle,
} from 'lucide-react';

export default function Library() {
  const { address, isConnected } = useWallet();
  const [purchases, setPurchases] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isConnected || !address) {
      setPurchases([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const ids = await getBuyerPurchases(address as `0x${string}`);
      const listings = await Promise.all(ids.map((id) => getListing(id)));
      setPurchases(listings.filter((l) => l.exists));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load your library.');
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    invalidateCache('buyer_purchases');
    invalidateCache('listing:');
    load();
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-300 transition hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to marketplace
          </Link>
          <WalletButton />
        </div>
      </header>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-purple-400" />
                <h1 className="text-2xl font-semibold">My Library</h1>
              </div>
              <p className="text-sm text-zinc-500">
                Prompts you own. Bodies are encrypted on-chain; click Unlock on each one to sign a
                small transaction that proves you are the seller or a real buyer and reveals it.
              </p>
            </div>
            {isConnected && (
              <button
                onClick={refresh}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          {!isConnected && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-12 text-center">
              <Lock className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
              <h3 className="mb-2 font-medium">Connect a wallet to unlock your library</h3>
              <p className="mb-6 text-sm text-zinc-500">
                Your purchases live on-chain. Connect the wallet you bought with to see them.
              </p>
              <div className="flex justify-center">
                <WalletButton />
              </div>
            </div>
          )}

          {isConnected && loading && (
            <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-zinc-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading your purchases...
            </div>
          )}

          {isConnected && error && !loading && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
              <p className="font-medium">Could not load your library</p>
              <p className="mt-1 text-red-400/80">{error}</p>
            </div>
          )}

          {isConnected && !loading && !error && purchases.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center">
              <p className="mb-2 text-zinc-400">No purchases yet.</p>
              <p className="text-sm text-zinc-500">
                Head to the marketplace to buy your first prompt.
              </p>
              <Link
                href="/"
                className="mt-4 inline-block rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-400"
              >
                Browse marketplace
              </Link>
            </div>
          )}

          {isConnected && !loading && !error && purchases.length > 0 && (
            <div className="grid gap-4">
              {purchases.map((listing) => (
                <PurchaseCard
                  key={listing.id?.toString()}
                  listing={listing}
                  account={address as `0x${string}`}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

type UnlockStage = 'idle' | 'signing' | 'waiting' | 'unlocked' | 'finalizing' | 'error';

function PurchaseCard({ listing, account }: { listing: Listing; account: `0x${string}` }) {
  const tags = listing.tags_csv ? listing.tags_csv.split(',').filter(Boolean) : [];
  const [body, setBody] = useState<string | null>(null);
  const [stage, setStage] = useState<UnlockStage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleUnlock() {
    if (!listing.id) return;
    setErrorMsg(null);
    try {
      setStage('signing');
      // claim_body is an authenticated WRITE: unlike the old free read, it
      // requires a signed transaction (small gas cost), which is exactly
      // what makes it unspoofable. waiting for consensus comes next.
      setStage('waiting');
      const b = await claimBody(listing.id, account);
      setBody(b);
      setStage('unlocked');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // This card only shows prompts get_buyer_purchases already reported
      // as owned. A "not authorized" here means the Registry's purchase
      // receipt (written when the buy finalizes) hasn't landed yet, not a
      // real access failure. Unlike the old auto-retrying read, we don't
      // silently resubmit -- that would mean signing a new transaction
      // without the user asking for it. We surface it and let them retry.
      if (/not authorized/i.test(raw)) {
        setStage('finalizing');
      } else {
        setErrorMsg(
          /user rejected|user denied/i.test(raw)
            ? 'You cancelled the unlock transaction in your wallet.'
            : 'Could not unlock the prompt. Try again in a moment.'
        );
        setStage('error');
      }
    }
  }

  async function handleCopy() {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-medium leading-snug">{listing.title}</h3>
          {listing.description && (
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">{listing.description}</p>
          )}
        </div>
        <span className="shrink-0 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-purple-300">
          {listing.category}
        </span>
      </div>

      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-400"
            >
              <Tag className="mr-1 h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-purple-300">
            {stage === 'unlocked' ? 'Your prompt (unlocked)' : 'Prompt body (encrypted on-chain)'}
          </p>
          {stage === 'unlocked' && body && (
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-200 transition hover:bg-purple-500/20"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  Copy
                </>
              )}
            </button>
          )}
        </div>

        {(stage === 'idle' || stage === 'error') && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Sign a small transaction to prove you are the buyer and reveal the full body.
            </p>
            <button
              onClick={handleUnlock}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-purple-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-purple-400"
            >
              <KeyRound className="h-3 w-3" />
              Unlock
            </button>
          </div>
        )}
        {errorMsg && stage === 'error' && (
          <div className="mt-2 flex items-start gap-2 text-xs text-red-400">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {(stage === 'signing' || stage === 'waiting') && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            {stage === 'signing'
              ? 'Approve the unlock transaction in your wallet...'
              : 'Verifying your purchase receipt on Bradbury (about 30-90s)...'}
          </div>
        )}
        {stage === 'finalizing' && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-purple-300/90">
              <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
              <span>
                Purchase accepted — waiting for the Registry receipt to finalize on
                Bradbury. Phase 1 finalization can take a while (sometimes 10+
                minutes); this isn&apos;t a failed purchase, just not settled yet.
                Unlock again once it lands.
              </span>
            </div>
            <button
              onClick={handleUnlock}
              className="inline-flex items-center gap-1.5 rounded-md border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-500/20"
            >
              <KeyRound className="h-3 w-3" />
              Try unlocking again
            </button>
          </div>
        )}
        {stage === 'unlocked' && body && (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-200">
            {body}
          </pre>
        )}
        {stage === 'unlocked' && !body && (
          <p className="text-xs text-zinc-500">(empty body)</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3 text-xs">
        <div>
          <p className="text-zinc-500">Seller</p>
          <p className="font-mono text-zinc-400">{shortAddress(listing.seller)}</p>
        </div>
        <div className="text-right">
          <p className="text-zinc-500">Paid</p>
          <p className="font-semibold text-purple-300">{formatGen(listing.price_wei)} GEN</p>
        </div>
      </div>

      <p className="mt-3 text-[10px] text-zinc-600">
        Body hash: <span className="font-mono">{listing.body_hash?.slice(0, 20)}...</span>
      </p>
    </div>
  );
}
