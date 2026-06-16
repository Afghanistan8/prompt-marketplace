import Link from 'next/link';
import {
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  Search,
  ShoppingBag,
  Layers,
  Cpu,
  ExternalLink,
  Coins,
} from 'lucide-react';
import { REGISTRY_ADDRESS, ESCROW_ADDRESS } from '../../lib/wagmi';

export default function HowItWorks() {
  return (
    <main className="min-h-screen">
      {/* Top nav */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm text-zinc-300 transition hover:text-zinc-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to marketplace
          </Link>
          <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-purple-300">
            Bradbury Testnet
          </span>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            How{' '}
            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Prompt Market
            </span>{' '}
            works
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-zinc-400">
            A prompt marketplace where the chain itself judges quality. Two intelligent contracts on
            GenLayer Bradbury handle every listing, every purchase, and every dispute — using real
            LLM consensus across multiple validators, not a centralized backend API.
          </p>
        </div>
      </section>

      {/* Three-step flow */}
      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-2xl font-semibold">The flow</h2>
          <p className="mb-10 text-sm text-zinc-500">
            From a draft prompt to a paid sale, in three on-chain steps.
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            <Step
              num="01"
              icon={<Sparkles className="h-5 w-5 text-purple-400" />}
              title="Seller lists a prompt"
              body="Sellers submit a title, description, prompt body hash, target models, and price. The transaction calls list_prompt on PromptRegistry."
            />
            <Step
              num="02"
              icon={<Cpu className="h-5 w-5 text-purple-400" />}
              title="Validators judge it"
              body="Multiple Bradbury validators independently run an LLM to categorize the listing and check for duplicates. They must agree via the GenLayer equivalence principle before the listing is accepted."
            />
            <Step
              num="03"
              icon={<ShoppingBag className="h-5 w-5 text-purple-400" />}
              title="Buyer pays in GEN"
              body="A buyer calls PromptEscrow.buy() with the native GEN price attached. The seller is paid immediately, a 2.5% platform fee is held, and the purchase is recorded as an on-chain receipt."
            />
          </div>
        </div>
      </section>

      {/* What makes it different */}
      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-2xl font-semibold">What makes it different</h2>
          <p className="mb-10 text-sm text-zinc-500">
            Most prompt marketplaces are centralized apps with an admin dashboard. This one isn’t.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Feature
              icon={<ShieldCheck className="h-5 w-5 text-purple-400" />}
              title="LLM-validated, not API-validated"
              body="PromptBase and similar centralized marketplaces moderate via a backend API. Here, the moderation logic IS the contract — every list_prompt triggers an LLM consensus round across multiple validators."
            />
            <Feature
              icon={<Search className="h-5 w-5 text-purple-400" />}
              title="Duplicate detection on-chain"
              body="Before a listing is accepted, validators check it against the existing ones via LLM comparison. Substantively duplicate prompts are auto-rejected with a reason recorded on-chain."
            />
            <Feature
              icon={<Sparkles className="h-5 w-5 text-purple-400" />}
              title="Auto-categorization"
              body="Each listing is auto-assigned one of 13 categories (json-schema-extraction, code-generation, agent-system-prompt, classification, summarization, etc.) by validator consensus."
            />
            <Feature
              icon={<Layers className="h-5 w-5 text-purple-400" />}
              title="Receipts as access control"
              body="Once you buy a prompt, has_purchased(you, prompt_id) returns true on-chain forever. Any future content-gating layer (Lit Protocol, encrypted IPFS) can use this as the authorization check."
            />
          </div>
        </div>
      </section>

      {/* Architecture */}
      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-2 text-2xl font-semibold">The two contracts</h2>
          <p className="mb-10 text-sm text-zinc-500">
            Deployed on GenLayer Bradbury Testnet (Phase 1).
          </p>
          <div className="space-y-6">
            <Contract
              title="PromptRegistry"
              address={REGISTRY_ADDRESS}
              role="The listings contract"
              description="Holds canonical metadata for every prompt: seller, title, description, price, LLM-assigned category, and deterministically-extracted tags. Runs LLM consensus paths for duplicate detection and categorization on every list_prompt call."
              methods={[
                'list_prompt(title, description, target_models, price, ipfs_cid, body_hash, preview) — submit a new listing',
                'get_listing(id) — read a single prompt',
                'get_all_active(limit) — paginated active listings',
                'deactivate / reactivate(id) — seller controls',
              ]}
            />
            <Contract
              title="PromptEscrow"
              address={ESCROW_ADDRESS}
              role="The payments + receipts contract"
              description="Handles all GEN flow. Validates the buyer attached the right amount, forwards the seller's cut immediately via gl.chain.Account.emit_transfer, holds the 2.5% platform fee, and records who bought what. Fully deterministic — no LLM consensus needed for payments."
              methods={[
                'buy(prompt_id, seller, price) — payable, executes the purchase',
                'has_purchased(buyer, prompt_id) — view, used for access checks',
                'get_buyer_purchases(buyer) — view, list of owned prompts',
                'get_sales_count(prompt_id) — view, lifetime sales',
                'platform_withdraw() — owner claims accumulated fees',
              ]}
            />
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-2xl font-semibold">Built on</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <StackCard
              title="GenLayer Bradbury"
              body="Intelligent contracts in Python, equivalence-principle consensus, on-chain LLM calls via gl.nondet.exec_prompt."
            />
            <StackCard
              title="Next.js + wagmi"
              body="App Router on Vercel. wagmi 2 + RainbowKit for wallet flow. genlayer-js SDK for contract reads + writes."
            />
            <StackCard
              title="Any EVM wallet"
              body="OKX, MetaMask, anything WalletConnect-compatible. The frontend bypasses MetaMask-only Snap RPCs to work with all wallets."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-500/5 to-pink-500/5 p-8">
            <div className="mb-4 flex items-center gap-2">
              <Coins className="h-5 w-5 text-purple-400" />
              <h3 className="text-lg font-medium">Platform economics</h3>
            </div>
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Seller receives</p>
                <p className="mt-1 text-2xl font-semibold text-purple-300">97.5%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Platform fee</p>
                <p className="mt-1 text-2xl font-semibold text-purple-300">2.5%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Listing fee</p>
                <p className="mt-1 text-2xl font-semibold text-purple-300">0</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-zinc-500">
              Sellers only pay gas on listing. No upfront fees, no recurring costs. Payouts happen
              automatically in the same transaction as the buy.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-800 px-6 py-16 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md bg-purple-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-purple-400"
        >
          <Sparkles className="h-4 w-4" />
          Browse the marketplace
        </Link>
      </section>

      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="mx-auto max-w-5xl text-center text-xs text-zinc-500">
          Built on GenLayer Bradbury Testnet (Phase 1). Test prompts may take 30–90s to clear LLM
          validator consensus.
        </div>
      </footer>
    </main>
  );
}

function Step({
  num,
  icon,
  title,
  body,
}: {
  num: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="relative rounded-lg border border-zinc-800 bg-zinc-900/40 p-6 transition hover:border-zinc-700 hover:bg-zinc-900/60">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-600">{num}</span>
        <div className="rounded-md border border-purple-500/30 bg-purple-500/10 p-1.5">{icon}</div>
      </div>
      <h3 className="mb-2 font-medium">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="rounded-md border border-purple-500/30 bg-purple-500/10 p-1.5">{icon}</div>
        <h3 className="font-medium">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}

function Contract({
  title,
  address,
  role,
  description,
  methods,
}: {
  title: string;
  address: string;
  role: string;
  description: string;
  methods: string[];
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-medium">{title}</h3>
          <p className="text-[10px] uppercase tracking-wide text-purple-300">{role}</p>
        </div>
        <a
          href={`https://explorer-bradbury.genlayer.com/contracts/${String(address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
        >
          {String(address).slice(0, 10)}…{String(address).slice(-8)}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">{description}</p>
      <p className="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">Key methods</p>
      <ul className="space-y-1.5">
        {methods.map((m) => (
          <li key={m} className="font-mono text-[11px] leading-relaxed text-zinc-300">
            {m}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StackCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <h3 className="mb-2 font-medium">{title}</h3>
      <p className="text-sm leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
}
