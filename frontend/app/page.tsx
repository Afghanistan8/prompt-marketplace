'use client';

import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Sparkles, ShieldCheck, Search } from 'lucide-react';
import { Marketplace } from '../components/Marketplace';

export default function Home() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-purple-400" />
            <span className="text-lg font-semibold tracking-tight">
              Prompt Market
            </span>
            <span className="ml-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">
              GenLayer
            </span>
          </div>
          <div className="flex items-center gap-4"><Link href="/how-it-works" className="text-sm text-zinc-400 transition hover:text-zinc-200">How it works</Link><ConnectButton /></div>
        </div>
      </header>

      <section className="px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            The first prompt marketplace where{' '}
            <span className="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              the chain itself
            </span>{' '}
            judges quality.
          </h1>
          <p className="mt-6 text-lg text-zinc-400">
            Listings are auto-categorized, duplicates are auto-rejected, and
            disputes are resolved by GenLayer Bradbury on-chain LLM consensus.
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-800 px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Auto-moderation"
            body="LLM validators catch duplicates and assign categories at listing time."
          />
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="Dispute resolution"
            body="Buyers can challenge listings. Validators re-run the prompt and rule."
          />
          <Feature
            icon={<Search className="h-5 w-5" />}
            title="Pay-to-unlock"
            body="Prompts are encrypted on IPFS. Purchase unlocks decryption via Lit Protocol."
          />
        </div>
      </section>

      <Marketplace />
    </main>
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
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-purple-500/10 text-purple-300">
        {icon}
      </div>
      <h3 className="mb-1 font-medium">{title}</h3>
      <p className="text-sm text-zinc-400">{body}</p>
    </div>
  );
}
