'use client';

import { createClient, abi } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { CalldataAddress } from 'genlayer-js/types';
import { REGISTRY_ADDRESS, ESCROW_ADDRESS } from './wagmi';

const readClient = createClient({ chain: testnetBradbury });

// ---------- Active wallet provider ----------
//
// genlayer-js signs through `config.provider || window.ethereum`. With multiple
// wallet extensions installed, window.ethereum is whichever one won the slot, so
// signing went to the wrong wallet. The EIP-6963 picker (lib/wallet.tsx) records
// the provider the user actually selected here, and every signing / gated-read
// client below passes it explicitly so the chosen wallet is the one that signs.
interface WalletProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}
let activeProvider: WalletProvider | null = null;

export function setActiveProvider(provider: WalletProvider | null): void {
  activeProvider = provider;
}

export function getActiveProvider(): WalletProvider | null {
  return activeProvider;
}

// Build a client bound to `account`, routing wallet methods to the selected
// provider when one is connected (falls back to genlayer-js's default otherwise).
function walletClient(account: `0x${string}`) {
  const cfg: Record<string, unknown> = { chain: testnetBradbury, account };
  if (activeProvider) cfg.provider = activeProvider;
  return createClient(cfg as any);
}

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

// GenVM `Address` parameters must be encoded with the calldata ADDR tag, not as
// a plain string. genlayer-js serializes a bare JS string as a GenVM `str`, so a
// contract method typed `buyer: Address` receives a str and blows up on
// `buyer.as_hex`. Wrapping the 20 address bytes in CalldataAddress makes
// genlayer-js emit the correct address type. Used for the escrow reads
// (has_purchased / get_buyer_purchases) whose signatures take an Address.
function toCalldataAddress(hex: `0x${string}`): CalldataAddress {
  const clean = hex.replace(/^0x/, '');
  if (clean.length !== 40) throw new Error(`invalid address: ${hex}`);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return new CalldataAddress(bytes);
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

// ---------- GenVM write-result decoding ----------
//
// A GenVM read's `from` is a caller-supplied, unauthenticated RPC param --
// spoofable. A write's sender is derived from a real signature the wallet
// produced over the transaction, so it can't be. v0.5 moves body delivery
// from a read (get_purchased_body, removed) to a write (claim_body), which
// closes that hole -- but it means the frontend has to pull the return
// value back out of the settled transaction instead of just reading state.
//
// First attempt (verified wrong against live Bradbury, not just guessed):
// genlayer-js's own `resultToUserFriendlyJson` decodes a result out of
// `consensus_data.leader_receipt[].result`, but that field only gets
// populated by `decodeLocalnetTransaction` -- which only runs for
// `client.chain.isStudio`. Empirically dumping a real testnet
// `client.getTransaction()` response (`node _tmp_inspect_tx.mjs` against a
// live tx during debugging) shows `consensus_data` doesn't exist on it at
// all on Bradbury; only `txExecutionResultName` / `resultName` do, with no
// return payload.
//
// What actually carries the return value on live Bradbury is
// `client.debugTraceTransaction({hash})` (`gen_dbg_traceTransaction` under
// the hood) -- the same call the official `genlayer` CLI's `trace` command
// uses. Verified directly: for a successful claim_body it returns
// `{result_code: 0, return_data: <calldata-encoded map>}` where the decoded
// map is `{kind: "Return", data: "<the plaintext body>", ...}`; for a
// reverted one, `{result_code: 1, ...}` with `{kind: "UserError", data:
// "not authorized: ..."}` -- same shape, `data` always the string that
// matters. It's a "dbg"-prefixed RPC, so treat it as the best available
// mechanism today rather than a guaranteed-stable public API; if GenLayer
// ships a first-class result-retrieval method later, prefer that instead.
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function decodeGenVMTrace(trace: { return_data?: string }): string {
  if (!trace.return_data) {
    throw new Error('claim_body trace had no return_data');
  }
  const decoded = abi.calldata.decode(hexToBytes(trace.return_data)) as
    | Map<string, unknown>
    | Record<string, unknown>;
  const get = (key: string) =>
    decoded instanceof Map ? decoded.get(key) : (decoded as Record<string, unknown>)[key];

  const kind = get('kind');
  const data = get('data');
  const message = typeof data === 'string' ? data : String(data ?? '');

  if (kind === 'Return') return message;
  throw new Error(message || `claim_body failed (${String(kind)})`);
}

// ---------- REGISTRY writes ----------

// v0.5: purchaser-gated content delivery via an authenticated write.
// claim_body(prompt_id) verifies the connected wallet is the seller or a
// recorded purchaser using GenVM's real, signature-derived sender -- unlike
// the removed get_purchased_body read, this cannot be bypassed by spoofing
// `from`. The plaintext body comes back as the write's own return value,
// read back via debugTraceTransaction (see decodeGenVMTrace above).
// Unauthorized callers get a UserError, surfaced as a thrown Error whose
// message contains "not authorized".
export async function claimBody(
  promptId: bigint,
  account: `0x${string}`
): Promise<string> {
  const client = walletClient(account);
  const hash = (await client.writeContract({
    address: REGISTRY_ADDRESS,
    functionName: 'claim_body',
    args: [promptId],
    value: 0n,
  } as any)) as string;

  await (client as any).waitForTransactionReceipt({
    hash,
    status: 'ACCEPTED',
    interval: 5_000,
    retries: 60,
  });

  const trace = await (client as any).debugTraceTransaction({ hash });
  return decodeGenVMTrace(trace);
}

export interface ListPromptArgs {
  title: string;
  description: string;
  target_models_csv: string;
  price_wei: bigint;
  ipfs_cid: string;
  body_hash: string;
  preview: string;
  body: string;
}

export async function listPrompt(args: ListPromptArgs, account: `0x${string}`): Promise<{ hash: string }> {
  const writeClient = walletClient(account);
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
      args.body,
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
      args: [toCalldataAddress(buyer), promptId],
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
      args: [toCalldataAddress(buyer)],
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

// v0.4: buy() takes ONLY prompt_id. Escrow reads the authoritative seller
// and price from the Registry via a synchronous cross-contract view, so the
// caller can no longer spoof them. priceWei is still passed here only because
// the wallet must attach exactly that much GEN as msg.value.
export async function buyPrompt(
  promptId: bigint,
  priceWei: bigint,
  account: `0x${string}`
): Promise<{ hash: string }> {
  const writeClient = walletClient(account);
  const hash = (await writeClient.writeContract({
    address: ESCROW_ADDRESS,
    functionName: 'buy',
    args: [promptId],
    value: priceWei,
  } as any)) as string;
  return { hash };
}

export async function waitForTx(hash: string, account: `0x${string}`): Promise<any> {
  const writeClient = walletClient(account);
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
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
