'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import {
  getAllActive,
  getBuyerPurchases,
  getEscrowSalesCount,
  formatGen,
  shortAddress,
  invalidateCache,
  type ActiveListing,
} from '../lib/genlayer';
import { Tag, ShoppingBag, Loader2, RefreshCw, Plus, Check } from 'lucide-react';
import { ListPromptModal } from './ListPromptModal';
import { BuyConfirmModal } from './BuyConfirmModal';

export function Marketplace() {
  const { address, isConnected } = useAccount();
  const [listings, setListings] = useState<ActiveListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [buyTarget, setBuyTarget] = useState<ActiveListing | null>(null);
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set());
  const [salesByListing, setSalesByListing] = useState<Map<string, bigint>>(new Map());

  const loadListings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAllActive(50n);
      setListings(data);
      setError(null);

      // Fetch fresh sales counts from Escrow (these are now the source of truth)
      const salesMap = new Map<string, bigint>();
      await Promise.all(
        data.map(async (l) => {
          try {
            const count = await getEscrowSalesCount(l.id);
            salesMap.set(l.id.toString(), count);
          } catch {
            // Fall back to Registry's count
            salesMap.set(l.id.toString(), l.sales_count);
          }
        })
      );
      setSalesByListing(salesMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOwnership = useCallback(async () => {
    if (!isConnected || !address) {
      setOwnedIds(new Set());
      return;
    }
    try {
      const purchased = await getBuyerPurchases(address as `0x${string}`);
      setOwnedIds(new Set(purchased.map((id) => id.toString())));
    } catch {
      setOwnedIds(new Set());
    }
  }, [address, isConnected]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useEffect(() => {
    loadOwnership();
  }, [loadOwnership]);

  function refresh() {
    invalidateCache('all_active');
    invalidateCache('escrow_sales');
    invalidateCache('buyer_purchases');
    loadListings();
    loadOwnership();
  }

  return (
    <section className="border-t border-zinc-800 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">Live listings</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/40 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="Refresh listings"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setListModalOpen(true)}
              className="flex items-center gap-1.5 rounded-md bg-purple-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-400"
            >
              <Plus className="h-4 w-4" />
              List a prompt
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-zinc-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading listings…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-sm text-red-300">
            <p className="font-medium">Couldn&apos;t load listings</p>
            <p className="mt-1 text-red-400/80">{error}</p>
          </div>
        )}

        {!loading && !error && listings.length === 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-12 text-center text-zinc-400">
            No active listings yet. Be the first to submit one.
          </div>
        )}

        {!loading && !error && listings.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => {
              const isOwned = ownedIds.has(l.id.toString());
              const isOwnListing =
                isConnected && address && address.toLowerCase() === l.seller.toLowerCase();
              const sales = salesByListing.get(l.id.toString()) ?? l.sales_count;
              return (
                <ListingCard
                  key={l.id.toString()}
                  listing={l}
                  sales={sales}
                  isOwned={isOwned}
                  isOwnListing={Boolean(isOwnListing)}
                  onBuy={() => setBuyTarget(l)}
                />
              );
            })}
          </div>
        )}
      </div>

      <ListPromptModal
        open={listModalOpen}
        onClose={() => setListModalOpen(false)}
        onSuccess={refresh}
      />
      <BuyConfirmModal
        open={Boolean(buyTarget)}
        listing={buyTarget}
        onClose={() => setBuyTarget(null)}
        onSuccess={refresh}
      />
    </section>
  );
}

function ListingCard({
  listing,
  sales,
  isOwned,
  isOwnListing,
  onBuy,
}: {
  listing: ActiveListing;
  sales: bigint;
  isOwned: boolean;
  isOwnListing: boolean;
  onBuy: () => void;
}) {
  const tags = listing.tags_csv ? listing.tags_csv.split(',').filter(Boolean) : [];

  return (
    <div className="group flex flex-col rounded-lg border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-zinc-700 hover:bg-zinc-900/60">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="font-medium leading-snug">{listing.title}</h3>
        <span className="shrink-0 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-purple-300">
          {listing.category}
        </span>
      </div>

      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1">
          {tags.slice(0, 4).map((tag) => (
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

      <div className="mt-auto flex items-center justify-between border-t border-zinc-800 pt-3">
        <div>
          <p className="text-xs text-zinc-500">Seller</p>
          <p className="font-mono text-xs text-zinc-300">{shortAddress(listing.seller)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">
            Price{sales > 0n && ` · ${sales.toString()} sold`}
          </p>
          <p className="text-sm font-semibold text-purple-300">{formatGen(listing.price_wei)} GEN</p>
        </div>
      </div>

      {isOwned ? (
        <div className="mt-4 flex items-center justify-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm font-medium text-green-300">
          <Check className="h-4 w-4" />
          Owned
        </div>
      ) : isOwnListing ? (
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-center text-xs text-zinc-500">
          Your listing
        </div>
      ) : (
        <button
          onClick={onBuy}
          className="mt-4 flex items-center justify-center gap-1.5 rounded-md bg-purple-500/90 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-500"
        >
          <ShoppingBag className="h-4 w-4" />
          Buy for {formatGen(listing.price_wei)} GEN
        </button>
      )}
    </div>
  );
}
