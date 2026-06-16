# v0.2.2
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

import json
import typing


STATUS_ACTIVE = "active"
STATUS_INACTIVE = "inactive"
STATUS_REJECTED = "rejected"

ALLOWED_CATEGORIES_CSV = "agent-system-prompt,json-schema-extraction,code-generation,code-review,rag-retrieval,classification,summarization,translation,creative-writing,data-analysis,roleplay-character,tool-use,other"

DUP_CHECK_CONTEXT_CAP = 10

STOP_WORDS_CSV = "the,a,an,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,have,has,had,do,does,did,can,could,should,would,will,this,that,these,those,it,its,you,your,we,our,they,their,them,not,no,yes,so,too,very,just,more,most,less,least,some,any,all,each,every,one,two,three,four,five,uses,use,using,used,user,users,prompt,prompts,prompt's,model,models,returns,return,returning,returned,given,gives,giving,gave,output,outputs,input,inputs,based,when,where,how,what,which,who,whom,whose,why,about,into,onto,upon,without,within,through,across,over,under,above,below,after,before,between,against,toward,towards,here,there,now,then"


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

    def __init__(self):
        self.owner = gl.message.sender_address
        self.next_id = u256(1)
        self.escrow_set = False

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
    ) -> u256:
        # Deterministic checks
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

        seller = gl.message.sender_address
        prompt_id = self.next_id

        # Duplicate check (LLM consensus on a binary decision)
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

        # Categorize via LLM consensus.
        # Output is constrained to a single enum value, so validators almost
        # always agree. We do NOT ask the LLM for tags here — tag generation
        # is too open-ended for strict_eq. We derive tags deterministically
        # from the listing text below.
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

        # Deterministic tag extraction from title + description.
        # Runs identically on every validator (no LLM, no consensus issue).
        tags_csv = self._extract_tags(title, description)

        # Store
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

    # ---------- Internal helpers ----------

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
        """Pull up to 5 lowercase tags from the listing text deterministically.
        Same input always yields same output, so all validators agree without
        any consensus call required."""
        stop_words = set(STOP_WORDS_CSV.split(","))

        text = (title + " " + description).lower()

        # Replace common separators with spaces
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
            # skip pure numbers
            if w.replace(".", "").isdigit():
                continue
            seen.append(w)
            if len(seen) >= 5:
                break

        return ",".join(seen)
