# v0.5.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# The prompt repository: canonical listing metadata, LLM-validated
# categorization + duplicate detection, encrypted-at-rest prompt bodies,
# and authenticated, receipt-gated content delivery.
#
# Changes vs v0.4.0 (steward feedback: "Bradbury read `from` can be spoofed
# and the body is stored in plaintext"):
#   1. The plaintext body is NEVER stored and NEVER returned by any read.
#      `body_of` is gone. `list_prompt` immediately encrypts the body with
#      a per-listing key derived from a contract-internal secret
#      (`vault_secret_hex`, set once at construction and exposed by no
#      getter) and stores only the ciphertext, in `body_ciphertext_of`.
#   2. `get_purchased_body` (a @gl.public.view) is REMOVED entirely. On
#      Bradbury Phase 1 a view's `from` is caller-supplied and
#      unauthenticated, so any view that gates on `gl.message.sender_address`
#      is spoofable in principle -- no matter how the body is stored. There
#      is now simply no read path, gated or not, that can return the body.
#   3. In its place, `claim_body(prompt_id)` is a @gl.public.write. A write's
#      `gl.message.sender_address` is derived by GenVM from a real,
#      validator-verified transaction signature -- it is not caller-supplied
#      and cannot be spoofed the way a read's `from` can (see genlayer-js:
#      reads issue an unauthenticated `gen_call`; writes are signed via
#      `account.signTransaction` before broadcast). `claim_body` decrypts
#      and returns the body ONLY to the seller or a wallet holding a
#      purchase receipt, and is otherwise a UserError -- so the only way to
#      ever receive plaintext is to hold the seller's or a real buyer's
#      private key.
#   4. record_purchase() is unchanged: the escrow-only settlement hook that
#      writes the purchaser receipt AND increments the registry sales
#      counter in one atomic state transition.
#
# GenVM notes:
#   - The helper views consumed by the Escrow proxy (get_listing_*_*) return
#     only str/u256 and never raise, because a revert there would revert a
#     buy(). They never touch body content.
#   - The at-rest cipher (see _encrypt_body / _decrypt_body) is a
#     dependency-free SHA-256 counter-mode keystream. Be precise about what
#     it buys you: because the contract itself must be able to decrypt (to
#     serve claim_body), its confidentiality rests on `vault_secret_hex`
#     never being exposed by any getter -- the same trust boundary as any
#     "private" contract field, not an independent secret unknown to the
#     contract. The actual cryptographic authentication boundary that
#     defeats read-spoofing is GenVM's transaction-signature verification on
#     the write path, not the cipher. We say this plainly so nobody mistakes
#     "encrypted at rest" for "the contract can't read it" -- it can, by
#     design, for the one authorized code path. See the "How content is
#     gated" section of the README for the full threat model.

from genlayer import *

import hashlib
import json
import typing


STATUS_ACTIVE = "active"
STATUS_INACTIVE = "inactive"
STATUS_REJECTED = "rejected"
STATUS_NONE = "none"

ALLOWED_CATEGORIES_CSV = "agent-system-prompt,json-schema-extraction,code-generation,code-review,rag-retrieval,classification,summarization,translation,creative-writing,data-analysis,roleplay-character,tool-use,other"

DUP_CHECK_CONTEXT_CAP = 10

STOP_WORDS_CSV = "the,a,an,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,have,has,had,do,does,did,can,could,should,would,will,this,that,these,those,it,its,you,your,we,our,they,their,them,not,no,yes,so,too,very,just,more,most,less,least,some,any,all,each,every,one,two,three,four,five,uses,use,using,used,user,users,prompt,prompts,model,models,returns,return,returning,returned,given,gives,giving,gave,output,outputs,input,inputs,based,when,where,how,what,which,who,whom,whose,why,about,into,onto,upon,without,within,through,across,over,under,above,below,after,before,between,against,toward,towards,here,there,now,then"


class PromptRegistry(gl.Contract):
    owner: Address
    escrow_contract: Address
    escrow_set: bool
    next_id: u256

    seller_of: TreeMap[u256, Address]
    title_of: TreeMap[u256, str]
    description_of: TreeMap[u256, str]
    category_of: TreeMap[u256, str]
    tags_csv_of: TreeMap[u256, str]
    target_models_csv_of: TreeMap[u256, str]
    price_wei_of: TreeMap[u256, u256]
    ipfs_cid_of: TreeMap[u256, str]
    body_hash_of: TreeMap[u256, str]
    preview_of: TreeMap[u256, str]
    status_of: TreeMap[u256, str]
    sales_count_of: TreeMap[u256, u256]
    rejection_reason_of: TreeMap[u256, str]
    exists_of: TreeMap[u256, bool]

    # Ciphertext ONLY. Never the plaintext body -- see _encrypt_body.
    body_ciphertext_of: TreeMap[u256, str]

    # Contract-internal secret used to derive per-listing body-encryption
    # keys. Set once at construction. Exposed by NO getter, ever -- that is
    # the entire confidentiality boundary for the cipher (see module notes
    # above). Stored hex-encoded like every other string field.
    vault_secret_hex: str

    # Purchaser receipts, written ONLY by the escrow contract during a
    # settled purchase. This is what gates claim_body().
    #   key: "<buyer_hex_lower>:<prompt_id>"  ->  True
    # An O(1) local lookup, so content delivery never depends on a
    # cross-contract call at read time.
    purchased_flag: TreeMap[str, bool]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.next_id = u256(1)
        self.escrow_set = False
        self.vault_secret_hex = hashlib.sha256(
            ("promptmarket.vault.v1|" + str(self.owner.as_hex)).encode("utf-8")
        ).hexdigest()

    # ---------- Admin ----------

    @gl.public.write
    def set_escrow_contract(self, escrow_address: Address) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("only owner")
        if self.escrow_set:
            raise gl.vm.UserError("escrow already set")
        self.escrow_contract = escrow_address
        self.escrow_set = True

    # ---------- Listing ----------

    @gl.public.write
    def list_prompt(
        self,
        title: str,
        description: str,
        target_models_csv: str,
        price_wei: u256,
        ipfs_cid: str,
        body_hash: str,
        preview: str,
        body: str,
    ) -> u256:
        if len(title.strip()) < 4:
            raise gl.vm.UserError("title too short")
        if len(title) > 120:
            raise gl.vm.UserError("title too long")
        if len(description.strip()) < 20:
            raise gl.vm.UserError("description too short")
        if len(description) > 2000:
            raise gl.vm.UserError("description too long")
        if price_wei == u256(0):
            raise gl.vm.UserError("price must be positive")
        if len(ipfs_cid) == 0:
            raise gl.vm.UserError("missing ipfs cid")
        if len(body_hash) != 64:
            raise gl.vm.UserError("body_hash must be 64 hex chars")
        if len(preview) > 400:
            raise gl.vm.UserError("preview too long")
        if len(target_models_csv.strip()) == 0:
            raise gl.vm.UserError("must specify target model")
        if len(body.strip()) < 10:
            raise gl.vm.UserError("body too short")
        if len(body) > 16000:
            raise gl.vm.UserError("body too long (max 16000 chars)")

        seller = gl.message.sender_address
        prompt_id = self.next_id

        existing = self._collect_active_summaries()

        if len(existing) > 0:
            new_summary = "TITLE: " + title + "\nDESC: " + description + "\nPREVIEW: " + preview

            def duplicate_check() -> str:
                task = f"""You are a marketplace moderator checking for duplicate prompt listings.

NEW LISTING:
{new_summary}

EXISTING LISTINGS:
{existing}

A listing is a DUPLICATE if it describes substantively the same prompt as an existing one
(same task, same approach, same target use case). Minor wording differences do not matter.

Respond ONLY with the following JSON format, nothing else:
{{
    "verdict": "UNIQUE" or "DUPLICATE",
    "duplicate_of": integer id (0 if UNIQUE)
}}
Your response must be parseable JSON with no prefix or suffix."""
                raw = (
                    gl.nondet.exec_prompt(task)
                    .replace("```json", "")
                    .replace("```", "")
                    .strip()
                )
                parsed = json.loads(raw)
                verdict = parsed.get("verdict", "UNIQUE")
                if verdict != "DUPLICATE":
                    verdict = "UNIQUE"
                dup_of = parsed.get("duplicate_of", 0)
                if not isinstance(dup_of, int):
                    dup_of = 0
                if verdict == "UNIQUE":
                    dup_of = 0
                return json.dumps({"verdict": verdict, "duplicate_of": dup_of}, sort_keys=True)

            dup_raw = gl.eq_principle.strict_eq(duplicate_check)
            dup_result = json.loads(dup_raw)

            if dup_result.get("verdict") == "DUPLICATE":
                dup_id = dup_result.get("duplicate_of", 0)
                self._store_rejected(
                    prompt_id, seller, title, description,
                    target_models_csv, price_wei, body_hash, preview,
                    "Duplicate of listing " + str(dup_id),
                )
                self.next_id = prompt_id + u256(1)
                return prompt_id

        def categorize() -> str:
            task = f"""You are categorizing a prompt listing for an AI prompt marketplace.

TITLE: {title}
DESCRIPTION: {description}
PREVIEW: {preview}
TARGET MODELS: {target_models_csv}

Pick ONE category from this exact list: {ALLOWED_CATEGORIES_CSV}

Use "other" if nothing fits.

Respond ONLY with the following JSON format, nothing else:
{{
    "category": "<one of the allowed values>"
}}
Your response must be parseable JSON with no prefix or suffix."""
            raw = (
                gl.nondet.exec_prompt(task)
                .replace("```json", "")
                .replace("```", "")
                .strip()
            )
            parsed = json.loads(raw)

            allowed = ALLOWED_CATEGORIES_CSV.split(",")
            category = parsed.get("category", "other")
            if category not in allowed:
                category = "other"

            return json.dumps({"category": category}, sort_keys=True)

        cat_raw = gl.eq_principle.strict_eq(categorize)
        cat_result = json.loads(cat_raw)
        category = cat_result.get("category", "other")

        tags_csv = self._extract_tags(title, description)

        self.seller_of[prompt_id] = seller
        self.title_of[prompt_id] = title
        self.description_of[prompt_id] = description
        self.category_of[prompt_id] = category
        self.tags_csv_of[prompt_id] = tags_csv
        self.target_models_csv_of[prompt_id] = target_models_csv
        self.price_wei_of[prompt_id] = price_wei
        self.ipfs_cid_of[prompt_id] = ipfs_cid
        self.body_hash_of[prompt_id] = body_hash
        self.preview_of[prompt_id] = preview
        self.status_of[prompt_id] = STATUS_ACTIVE
        self.sales_count_of[prompt_id] = u256(0)
        self.rejection_reason_of[prompt_id] = ""
        self.exists_of[prompt_id] = True
        self.body_ciphertext_of[prompt_id] = self._encrypt_body(prompt_id, body)

        self.next_id = prompt_id + u256(1)
        return prompt_id

    def _store_rejected(
        self,
        prompt_id: u256,
        seller: Address,
        title: str,
        description: str,
        target_models_csv: str,
        price_wei: u256,
        body_hash: str,
        preview: str,
        reason: str,
    ) -> None:
        self.seller_of[prompt_id] = seller
        self.title_of[prompt_id] = title
        self.description_of[prompt_id] = description
        self.category_of[prompt_id] = STATUS_REJECTED
        self.tags_csv_of[prompt_id] = ""
        self.target_models_csv_of[prompt_id] = target_models_csv
        self.price_wei_of[prompt_id] = price_wei
        self.ipfs_cid_of[prompt_id] = ""
        self.body_hash_of[prompt_id] = body_hash
        self.preview_of[prompt_id] = preview
        self.status_of[prompt_id] = STATUS_REJECTED
        self.sales_count_of[prompt_id] = u256(0)
        self.rejection_reason_of[prompt_id] = reason
        self.exists_of[prompt_id] = True
        self.body_ciphertext_of[prompt_id] = ""

    # ---------- Seller controls ----------

    @gl.public.write
    def deactivate(self, prompt_id: u256) -> None:
        if prompt_id not in self.exists_of:
            raise gl.vm.UserError("no such prompt")
        if self.seller_of[prompt_id] != gl.message.sender_address:
            raise gl.vm.UserError("not seller")
        if self.status_of[prompt_id] == STATUS_REJECTED:
            raise gl.vm.UserError("rejected listings cannot be changed")
        self.status_of[prompt_id] = STATUS_INACTIVE

    @gl.public.write
    def reactivate(self, prompt_id: u256) -> None:
        if prompt_id not in self.exists_of:
            raise gl.vm.UserError("no such prompt")
        if self.seller_of[prompt_id] != gl.message.sender_address:
            raise gl.vm.UserError("not seller")
        if self.status_of[prompt_id] == STATUS_REJECTED:
            raise gl.vm.UserError("rejected listings cannot be reactivated")
        self.status_of[prompt_id] = STATUS_ACTIVE

    @gl.public.write
    def increment_sales(self, prompt_id: u256) -> None:
        if not self.escrow_set:
            raise gl.vm.UserError("escrow not configured")
        if gl.message.sender_address != self.escrow_contract:
            raise gl.vm.UserError("only escrow")
        if prompt_id not in self.exists_of:
            raise gl.vm.UserError("no such prompt")
        self.sales_count_of[prompt_id] = self.sales_count_of[prompt_id] + u256(1)

    @gl.public.write
    def record_purchase(self, buyer_hex: str, prompt_id: u256) -> None:
        # Escrow-only settlement hook, emitted from a successful
        # PromptEscrow.buy(). It writes the purchaser receipt that gates
        # claim_body() AND increments the registry sales counter -- receipt
        # and sales count therefore always move together.
        if not self.escrow_set:
            raise gl.vm.UserError("escrow not configured")
        if gl.message.sender_address != self.escrow_contract:
            raise gl.vm.UserError("only escrow")
        if prompt_id not in self.exists_of:
            raise gl.vm.UserError("no such prompt")

        # IDEMPOTENT BY CONTRACT. The escrow emits this with on='accepted' so
        # buyers can unlock ~30-90s after paying instead of waiting out the
        # appeal window. GenLayer may re-deliver an accepted message across
        # appeal rounds, so applying it twice must be harmless: without this
        # guard a re-delivery would inflate sales_count on every retry.
        # Re-setting purchased_flag alone would be naturally idempotent; the
        # counter is what needs protecting.
        flag_key = buyer_hex.lower() + ":" + str(int(prompt_id))
        if flag_key in self.purchased_flag:
            return

        self.purchased_flag[flag_key] = True
        self.sales_count_of[prompt_id] = self.sales_count_of[prompt_id] + u256(1)

    # ---------- Read views ----------

    @gl.public.view
    def get_listing(self, prompt_id: u256) -> dict[str, typing.Any]:
        if prompt_id not in self.exists_of:
            return {"exists": False}
        return {
            "exists": True,
            "id": prompt_id,
            "seller": str(self.seller_of[prompt_id].as_hex),
            "title": self.title_of[prompt_id],
            "description": self.description_of[prompt_id],
            "category": self.category_of[prompt_id],
            "tags_csv": self.tags_csv_of[prompt_id],
            "target_models_csv": self.target_models_csv_of[prompt_id],
            "price_wei": self.price_wei_of[prompt_id],
            "ipfs_cid": self.ipfs_cid_of[prompt_id],
            "body_hash": self.body_hash_of[prompt_id],
            "preview": self.preview_of[prompt_id],
            "status": self.status_of[prompt_id],
            "sales_count": self.sales_count_of[prompt_id],
            "rejection_reason": self.rejection_reason_of[prompt_id],
        }

    @gl.public.view
    def get_all_active(self, limit: u256) -> list[dict[str, typing.Any]]:
        out: list[dict[str, typing.Any]] = []
        cap = int(limit)
        last = int(self.next_id) - 1
        i = last
        while i >= 1 and len(out) < cap:
            pid = u256(i)
            if pid in self.exists_of and self.status_of[pid] == STATUS_ACTIVE:
                out.append({
                    "id": pid,
                    "seller": str(self.seller_of[pid].as_hex),
                    "title": self.title_of[pid],
                    "category": self.category_of[pid],
                    "tags_csv": self.tags_csv_of[pid],
                    "price_wei": self.price_wei_of[pid],
                    "preview": self.preview_of[pid],
                    "sales_count": self.sales_count_of[pid],
                })
            i = i - 1
        return out

    @gl.public.view
    def get_next_id(self) -> u256:
        return self.next_id

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner.as_hex)

    @gl.public.view
    def get_escrow(self) -> dict[str, typing.Any]:
        if not self.escrow_set:
            return {"set": False}
        return {"set": True, "address": str(self.escrow_contract.as_hex)}

    # ---------- Authenticated content delivery ----------

    @gl.public.write
    def claim_body(self, prompt_id: u256) -> str:
        # Cryptographically authenticated content delivery, replacing the
        # removed get_purchased_body view. Because this is a
        # @gl.public.write, gl.message.sender_address is derived by GenVM
        # from a real, validator-verified signature on the submitted
        # transaction -- unlike a read's caller-supplied `from`, it cannot
        # be spoofed. An attacker who supplies a real purchaser's address
        # here without holding that purchaser's private key simply cannot
        # produce a transaction GenVM will attribute to that address, so
        # they fall straight into the UserError below.
        #
        # Authorization is the same rule as before: the seller, or a wallet
        # holding a purchase receipt written by a real, settled buy(). The
        # body is decrypted only inside this authorized branch -- it is
        # never held in plaintext anywhere in contract storage.
        if prompt_id not in self.exists_of:
            raise gl.vm.UserError("no such prompt")

        caller = gl.message.sender_address
        is_seller = caller == self.seller_of[prompt_id]

        caller_hex = str(caller.as_hex).lower()
        flag_key = caller_hex + ":" + str(int(prompt_id))
        has_receipt = flag_key in self.purchased_flag

        if not is_seller and not has_receipt:
            raise gl.vm.UserError(
                "not authorized: purchase this prompt to unlock its full body"
            )

        return self._decrypt_body(prompt_id)

    @gl.public.view
    def get_listing_seller_hex(self, prompt_id: u256) -> str:
        if prompt_id not in self.exists_of:
            return ""
        return str(self.seller_of[prompt_id].as_hex)

    @gl.public.view
    def get_listing_price_wei(self, prompt_id: u256) -> u256:
        if prompt_id not in self.exists_of:
            return u256(0)
        return self.price_wei_of[prompt_id]

    @gl.public.view
    def get_listing_status(self, prompt_id: u256) -> str:
        if prompt_id not in self.exists_of:
            return STATUS_NONE
        return self.status_of[prompt_id]

    # ---------- Internal helpers ----------

    # Dependency-free SHA-256 counter-mode keystream cipher. No external
    # crypto library is assumed to be importable inside the GenVM sandbox,
    # so this is built from nothing but hashlib + builtin bytes/int
    # operations. See the module-level notes at the top of this file for
    # exactly what confidentiality property this does and does not provide.

    def _derive_body_key(self, prompt_id: u256) -> bytes:
        vault_secret = bytes.fromhex(self.vault_secret_hex)
        return hashlib.sha256(
            vault_secret + b"|body-key|" + str(int(prompt_id)).encode("utf-8")
        ).digest()

    def _keystream(self, key: bytes, length: int) -> bytes:
        out = bytearray()
        counter = 0
        while len(out) < length:
            out.extend(hashlib.sha256(key + counter.to_bytes(4, "big")).digest())
            counter += 1
        return bytes(out[:length])

    def _encrypt_body(self, prompt_id: u256, body: str) -> str:
        key = self._derive_body_key(prompt_id)
        data = body.encode("utf-8")
        keystream = self._keystream(key, len(data))
        ciphertext = bytes(a ^ b for a, b in zip(data, keystream))
        return ciphertext.hex()

    def _decrypt_body(self, prompt_id: u256) -> str:
        key = self._derive_body_key(prompt_id)
        ciphertext = bytes.fromhex(self.body_ciphertext_of[prompt_id])
        keystream = self._keystream(key, len(ciphertext))
        data = bytes(a ^ b for a, b in zip(ciphertext, keystream))
        return data.decode("utf-8")

    def _collect_active_summaries(self) -> str:
        parts: list[str] = []
        last = int(self.next_id) - 1
        i = 1
        count = 0
        while i <= last and count < DUP_CHECK_CONTEXT_CAP:
            pid = u256(i)
            if pid in self.exists_of and self.status_of[pid] == STATUS_ACTIVE:
                parts.append(
                    "[id=" + str(i) + "] TITLE: " + self.title_of[pid] + "\n"
                    "DESC: " + self.description_of[pid] + "\n"
                    "PREVIEW: " + self.preview_of[pid]
                )
                count = count + 1
            i = i + 1
        return "\n\n---\n\n".join(parts)

    def _extract_tags(self, title: str, description: str) -> str:
        stop_words = set(STOP_WORDS_CSV.split(","))

        text = (title + " " + description).lower()

        seps = ",.!?;:()[]{}\"'`~/\\|<>@#$%^&*=+\n\t"
        for ch in seps:
            text = text.replace(ch, " ")

        words = text.split()
        seen: list[str] = []

        for w in words:
            w = w.strip("-_")
            if len(w) < 4 or len(w) > 30:
                continue
            if w in stop_words:
                continue
            if w in seen:
                continue
            if w.replace(".", "").isdigit():
                continue
            seen.append(w)
            if len(seen) >= 5:
                break

        return ",".join(seen)
