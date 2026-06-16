'use client';

import { createClient } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { REGISTRY_ADDRESS, ESCROW_ADDRESS } from './wagmi';

// Read-only client
const readClient = createClient({ chain: testnetBradbury });

// ---------- Types ----------

export interface Listing {
  exists: boolean;
  id?: bigint;
  seller?: string;
  title?: string;
  description?: string;
  category?: string;
  tags_csv?: string;
  target_models_csv?: string;
  price_wei?: bigint;
  ipfs_cid?: string;
  body_hash?: string;
  preview?: string;
  status?: string;
  sales_count?: bigint;
  rejection_reason?: string;
}

export interface ActiveListing {
  id: bigint;
  seller: string;
  title: string;
  category: string;
  tags_csv: string;
  price_wei: bigint;
  preview: string;
  sales_count: bigint;
}

// ---------- Helpers ----------

function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') return BigInt(v);
  return 0n;
}

function normalizeListing(raw: any): Listing {
  if (!raw || raw.exists === false) return { exists: false };
  return {
    exists: true,
    id: toBigInt(raw.id),
    seller: String(raw.seller || ''),
    title: String(raw.title || ''),
    description: String(raw.description || ''),
    category: String(raw.category || ''),
    tags_csv: String(raw.tags_csv || ''),
    target_models_csv: String(raw.target_models_csv || ''),
    price_wei: toBigInt(raw.price_wei),
    ipfs_cid: String(raw.ipfs_cid || ''),
    body_hash: String(raw.body_hash || ''),
    preview: String(raw.preview || ''),
    status: String(raw.status || ''),
    sales_count: toBigInt(raw.sales_count),
    rejection_reason: String(raw.rejection_reason || ''),
  };
}

function normalizeActive(raw: any): ActiveListing {
  return {
    id: toBigInt(raw.id),
    seller: String(raw.seller || ''),
    title: String(raw.title || ''),
    category: String(raw.category || ''),
    tags_csv: String(raw.tags_csv || ''),
    price_wei: toBigInt(raw.price_wei),
    preview: String(raw.preview || ''),
    sales_count: toBigInt(raw.sales_count),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, baseDelayMs = 1500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const isRateLimit =
        msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many');
      if (!isRateLimit || attempt === retries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  throw lastErr;
}

interface CacheEntry<T> { value: T; expiresAt: number; }
const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const TTL_MS = 30_000;

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;
  const flying = inflight.get(key) as Promise<T> | undefined;
  if (flying) return flying;
  const promise = (async () => {
    try {
      const value = await withRetry(fetcher);
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

export function invalidateCache(prefix?: string) {
  if (!prefix) { cache.clear(); return; }
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

// ---------- REGISTRY reads ----------

export async function getNextId(): Promise<bigint> {
  return cached('next_id', async () => {
    const result = await readClient.readContract({
      address: REGISTRY_ADDRESS,
      functionName: 'get_next_id',
      args: [],
    });
    return toBigInt(result);
  });
}

export async function getListing(promptId: bigint): Promise<Listing> {
  return cached(`listing:${promptId}`, async () => {
    const result = await readClient.readContract({
      address: REGISTRY_ADDRESS,
      functionName: 'get_listing',
      args: [promptId],
    });
    return normalizeListing(result);
  });
}

export async function getAllActive(limit = 50n): Promise<ActiveListing[]> {
  return cached(`all_active:${limit}`, async () => {
    const result = (await readClient.readContract({
      address: REGISTRY_ADDRESS,
      functionName: 'get_all_active',
      args: [limit],
    })) as any[];
    if (!Array.isArray(result)) return [];
    return result.map(normalizeActive);
  });
}

// ---------- REGISTRY writes ----------

export interface ListPromptArgs {
  title: string;
  description: string;
  target_models_csv: string;
  price_wei: bigint;
  ipfs_cid: string;
  body_hash: string;
  preview: string;
}

export async function listPrompt(args: ListPromptArgs, account: `0x${string}`): Promise<{ hash: string }> {
  const writeClient = createClient({ chain: testnetBradbury, account });
  const hash = (await writeClient.writeContract({
    address: REGISTRY_ADDRESS,
    functionName: 'list_prompt',
    args: [
      args.title,
      args.description,
      args.target_models_csv,
      args.price_wei,
      args.ipfs_cid,
      args.body_hash,
      args.preview,
    ],
    value: 0n,
  } as any)) as string;
  return { hash };
}

// ---------- ESCROW reads ----------

export async function hasPurchased(buyer: `0x${string}`, promptId: bigint): Promise<boolean> {
  return cached(`has_purchased:${buyer}:${promptId}`, async () => {
    const result = await readClient.readContract({
      address: ESCROW_ADDRESS,
      functionName: 'has_purchased',
      args: [buyer, promptId],
    });
    return Boolean(result);
  });
}

export async function getEscrowSalesCount(promptId: bigint): Promise<bigint> {
  return cached(`escrow_sales:${promptId}`, async () => {
    const result = await readClient.readContract({
      address: ESCROW_ADDRESS,
      functionName: 'get_sales_count',
      args: [promptId],
    });
    return toBigInt(result);
  });
}

export async function getBuyerPurchases(buyer: `0x${string}`): Promise<bigint[]> {
  return cached(`buyer_purchases:${buyer}`, async () => {
    const result = (await readClient.readContract({
      address: ESCROW_ADDRESS,
      functionName: 'get_buyer_purchases',
      args: [buyer],
    })) as any[];
    if (!Array.isArray(result)) return [];
    return result.map(toBigInt);
  });
}

export async function getEscrowStats(): Promise<{
  total_volume_wei: bigint;
  total_sales_count: bigint;
  platform_balance: bigint;
  platform_fee_bps: bigint;
  owner: string;
}> {
  return cached('escrow_stats', async () => {
    const result = (await readClient.readContract({
      address: ESCROW_ADDRESS,
      functionName: 'get_stats',
      args: [],
    })) as any;
    return {
      total_volume_wei: toBigInt(result?.total_volume_wei),
      total_sales_count: toBigInt(result?.total_sales_count),
      platform_balance: toBigInt(result?.platform_balance),
      platform_fee_bps: toBigInt(result?.platform_fee_bps),
      owner: String(result?.owner || ''),
    };
  });
}

// ---------- ESCROW writes ----------

export async function buyPrompt(
  promptId: bigint,
  seller: `0x${string}`,
  priceWei: bigint,
  account: `0x${string}`
): Promise<{ hash: string }> {
  const writeClient = createClient({ chain: testnetBradbury, account });
  const hash = (await writeClient.writeContract({
    address: ESCROW_ADDRESS,
    functionName: 'buy',
    args: [promptId, seller, priceWei],
    value: priceWei,
  } as any)) as string;
  return { hash };
}

export async function waitForTx(hash: string, account: `0x${string}`): Promise<any> {
  const writeClient = createClient({ chain: testnetBradbury, account });
  return (writeClient as any).waitForTransactionReceipt({
    hash,
    status: 'ACCEPTED',
    interval: 5_000,
    retries: 60,
  });
}

// ---------- Hashing ----------

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const bytes = enc.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function placeholderCidFromHash(hashHex: string): string {
  return 'bafy' + hashHex.slice(0, 52);
}

// ---------- Display ----------

export function formatGen(wei: bigint | undefined | null): string {
  if (wei === undefined || wei === null) return '0';
  const w = toBigInt(wei);
  const whole = w / 10n ** 18n;
  const frac = w % 10n ** 18n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function shortAddress(addr: string | undefined | null): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
