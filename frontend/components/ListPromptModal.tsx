'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { X, Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import {
  listPrompt,
  waitForTx,
  sha256Hex,
  placeholderCidFromHash,
  invalidateCache,
} from '../lib/genlayer';

type Stage = 'idle' | 'preparing' | 'signing' | 'waiting' | 'success' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ListPromptModal({ open, onClose, onSuccess }: Props) {
  const { address, isConnected } = useAccount();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [targetModels, setTargetModels] = useState('gpt-4,claude-opus-4');
  const [priceGen, setPriceGen] = useState('1');
  const [preview, setPreview] = useState('');

  const [stage, setStage] = useState<Stage>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setTitle('');
    setDescription('');
    setBody('');
    setTargetModels('gpt-4,claude-opus-4');
    setPriceGen('1');
    setPreview('');
    setStage('idle');
    setErrorMsg(null);
    setTxHash(null);
  }

  async function handleSubmit() {
    setErrorMsg(null);

    if (!isConnected || !address) {
      setErrorMsg('Connect your wallet first.');
      return;
    }
    if (title.trim().length < 4) return setErrorMsg('Title must be at least 4 characters.');
    if (description.trim().length < 20) return setErrorMsg('Description must be at least 20 characters.');
    if (body.trim().length < 10) return setErrorMsg('Prompt body is required.');
    if (!targetModels.trim()) return setErrorMsg('Target models required.');
    const priceNum = Number(priceGen);
    if (!Number.isFinite(priceNum) || priceNum <= 0) return setErrorMsg('Price must be a positive number.');

    try {
      setStage('preparing');
      const hash = await sha256Hex(body);
      const cid = placeholderCidFromHash(hash);
      const priceWei = BigInt(Math.floor(priceNum * 1e18));
      const previewText = preview.trim() || body.slice(0, 200);

      setStage('signing');
      const { hash: txHashValue } = await listPrompt(
        {
          title: title.trim(),
          description: description.trim(),
          target_models_csv: targetModels.trim(),
          price_wei: priceWei,
          ipfs_cid: cid,
          body_hash: hash,
          preview: previewText,
        },
        address as `0x${string}`
      );
      setTxHash(txHashValue);

      setStage('waiting');
      await waitForTx(txHashValue, address as `0x${string}`);

      setStage('success');
      invalidateCache('all_active');
      invalidateCache('next_id');
      onSuccess();
    } catch (e) {
      console.error('[List] submit error:', e);
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

  const isSubmitting = stage === 'preparing' || stage === 'signing' || stage === 'waiting';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            <h2 className="text-lg font-semibold">List a prompt</h2>
          </div>
          <button
            onClick={() => {
              if (isSubmitting) return;
              onClose();
              if (stage === 'success') reset();
            }}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-50"
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          {stage === 'success' ? (
            <SuccessView txHash={txHash} onDone={() => { onClose(); reset(); }} />
          ) : (
            <Form
              title={title}
              setTitle={setTitle}
              description={description}
              setDescription={setDescription}
              body={body}
              setBody={setBody}
              targetModels={targetModels}
              setTargetModels={setTargetModels}
              priceGen={priceGen}
              setPriceGen={setPriceGen}
              preview={preview}
              setPreview={setPreview}
              disabled={isSubmitting}
            />
          )}

          {errorMsg && stage !== 'success' && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isSubmitting && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-purple-500/20 bg-purple-500/5 p-3 text-sm text-purple-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>
                {stage === 'preparing' && 'Hashing prompt body…'}
                {stage === 'signing' && 'Approve the transaction in your wallet…'}
                {stage === 'waiting' &&
                  'Waiting for validator consensus. LLM categorization + duplicate check (~30–90s)…'}
              </span>
            </div>
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
              onClick={handleSubmit}
              disabled={isSubmitting || !isConnected}
              className="flex items-center gap-1.5 rounded-md bg-purple-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-400 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit listing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface FormProps {
  title: string;
  setTitle: (s: string) => void;
  description: string;
  setDescription: (s: string) => void;
  body: string;
  setBody: (s: string) => void;
  targetModels: string;
  setTargetModels: (s: string) => void;
  priceGen: string;
  setPriceGen: (s: string) => void;
  preview: string;
  setPreview: (s: string) => void;
  disabled: boolean;
}

function Form(p: FormProps) {
  return (
    <div className="space-y-4">
      <Field label="Title" hint="Short, descriptive name (4–120 chars)">
        <input
          value={p.title}
          onChange={(e) => p.setTitle(e.target.value)}
          disabled={p.disabled}
          placeholder="e.g. Strict JSON Extractor for Invoices"
          className={inputCls}
        />
      </Field>

      <Field label="Description" hint="What does this prompt do? (20–2000 chars)">
        <textarea
          value={p.description}
          onChange={(e) => p.setDescription(e.target.value)}
          disabled={p.disabled}
          rows={3}
          placeholder="Explain what the prompt does, its input format, and its output format. Validators use this to categorize and check for duplicates."
          className={inputCls}
        />
      </Field>

      <Field label="Prompt body" hint="The actual prompt text. Hashed on submit; full body stays off-chain for v1.">
        <textarea
          value={p.body}
          onChange={(e) => p.setBody(e.target.value)}
          disabled={p.disabled}
          rows={5}
          placeholder="You are an assistant that..."
          className={`${inputCls} font-mono text-xs`}
        />
      </Field>

      <Field label="Preview" hint="Optional. Public teaser shown before purchase. Defaults to first 200 chars of body.">
        <textarea
          value={p.preview}
          onChange={(e) => p.setPreview(e.target.value)}
          disabled={p.disabled}
          rows={2}
          placeholder="(optional)"
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Target models" hint="Comma-separated">
          <input
            value={p.targetModels}
            onChange={(e) => p.setTargetModels(e.target.value)}
            disabled={p.disabled}
            placeholder="gpt-4,claude-opus-4"
            className={inputCls}
          />
        </Field>

        <Field label="Price (GEN)" hint="Per purchase">
          <input
            value={p.priceGen}
            onChange={(e) => p.setPriceGen(e.target.value)}
            disabled={p.disabled}
            type="number"
            min="0"
            step="0.01"
            placeholder="1"
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-zinc-300">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30 disabled:opacity-50';

function SuccessView({ txHash, onDone }: { txHash: string | null; onDone: () => void }) {
  return (
    <div className="py-4 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
      <h3 className="mt-3 text-base font-medium">Listing submitted</h3>
      <p className="mt-1 text-sm text-zinc-400">
        Validators reached consensus. Check the listings section to see how your prompt was
        categorized — or whether it was caught as a duplicate.
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
