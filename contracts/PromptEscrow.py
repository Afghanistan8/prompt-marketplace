# v0.4.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# Settlement contract for the Prompt Marketplace.
#
# What changed vs v0.3.1 (steward feedback):
#   1. buy() takes ONLY the prompt_id. The caller can no longer supply a
#      seller or price -- both are read authoritatively from the Registry
#      at settlement time via a synchronous cross-contract view call. This
#      removes the trust-the-caller surface entirely.
#   2. All O(n) scans are gone. Double-buy prevention, has_purchased, and
#      get_buyer_purchases are O(1) / O(k-in-buyer) using flat composite
#      string keys ("<buyer_hex>:<prompt_id>") in TreeMaps.
#   3. During settlement, escrow emits ONE atomic message to the Registry --
#      record_purchase(buyer_hex, prompt_id) -- which both writes the
#      purchaser receipt (used to gate content delivery) AND increments the
#      registry sales counter. Receipt + sales count therefore always move
#      together, and only on finalization of a real, paid purchase.
#
# GenVM notes:
#   - A UserError anywhere in buy() rolls back ALL local state changes AND
#     the queued outbound messages (emit_transfer / record_purchase), so
#     settlement is atomic: money and receipts move together or not at all.
#   - The interface proxy only crosses str / u256 return types. Address and
#     bool view *return* types are not reliably handled by the current schema
#     extractor, so seller is carried as a hex string across the boundary.

from genlayer import *

import typing


@gl.contract_interface
class PromptRegistryProxy:
    class View:
        def get_listing_seller_hex(self, prompt_id: u256) -> str:
            ...

        def get_listing_price_wei(self, prompt_id: u256) -> u256:
            ...

        def get_listing_status(self, prompt_id: u256) -> str:
            ...

    class Write:
        # Records the purchaser receipt AND increments the registry sales
        # count in one atomic Registry state transition.
        def record_purchase(self, buyer_hex: str, prompt_id: u256) -> None:
            ...


class PromptEscrow(gl.Contract):
    owner: Address
    platform_fee_bps: u256
    registry_address: Address
    next_purchase_id: u256
    platform_balance: u256
    total_volume_wei: u256
    total_sales_count: u256

    # Purchase records, keyed by purchase_id.
    buyer_of: TreeMap[u256, Address]
    prompt_id_of: TreeMap[u256, u256]
    seller_of: TreeMap[u256, Address]
    price_wei_of: TreeMap[u256, u256]
    exists_of: TreeMap[u256, bool]

    # O(1) double-buy guard: "<buyer_hex_lower>:<prompt_id>" -> True
    purchased_flag: TreeMap[str, bool]

    # O(k) per-buyer index so get_buyer_purchases never scans all purchases.
    #   buyer_count["<buyer_hex_lower>"]            -> number of prompts owned
    #   buyer_item["<buyer_hex_lower>:<index>"]     -> prompt_id
    buyer_count: TreeMap[str, u256]
    buyer_item: TreeMap[str, u256]

    # Per-prompt lifetime sales counter (mirrors the Registry's counter).
    sales_count: TreeMap[u256, u256]

    def __init__(self, platform_fee_bps: u256, registry_address: Address):
        if platform_fee_bps > u256(2000):
            raise gl.vm.UserError("platform fee too high (max 20%)")
        self.owner = gl.message.sender_address
        self.platform_fee_bps = platform_fee_bps
        self.registry_address = registry_address
        self.next_purchase_id = u256(1)
        self.platform_balance = u256(0)
        self.total_volume_wei = u256(0)
        self.total_sales_count = u256(0)

    # ---------- BUY (registry-verified settlement) ----------

    @gl.public.write.payable
    def buy(self, prompt_id: u256) -> u256:
        registry = PromptRegistryProxy(self.registry_address)

        # 1. Authoritative listing state, read synchronously from the Registry.
        status = registry.view().get_listing_status(prompt_id)
        if status != "active":
            raise gl.vm.UserError("listing is not active or does not exist")

        listing_price = registry.view().get_listing_price_wei(prompt_id)
        if listing_price == u256(0):
            raise gl.vm.UserError("listing price is zero")

        seller_hex = registry.view().get_listing_seller_hex(prompt_id)
        if len(seller_hex) == 0:
            raise gl.vm.UserError("listing has no seller on record")
        seller = Address(seller_hex)

        # 2. Payment must match the authoritative price exactly.
        if gl.message.value != listing_price:
            raise gl.vm.UserError("attached value does not match listing price")

        # 3. Buyer / seller checks.
        buyer = gl.message.sender_address
        if buyer == seller:
            raise gl.vm.UserError("seller cannot buy own listing")

        buyer_hex = str(buyer.as_hex).lower()
        flag_key = buyer_hex + ":" + str(int(prompt_id))
        if flag_key in self.purchased_flag:
            raise gl.vm.UserError("already purchased this listing")

        # ---- Past this point nothing can raise: state changes are committed
        # ---- together and the outbound messages are queued atomically. ----

        purchase_id = self.next_purchase_id

        fee = (listing_price * self.platform_fee_bps) // u256(10000)
        proceeds = listing_price - fee

        # Local purchase record.
        self.buyer_of[purchase_id] = buyer
        self.prompt_id_of[purchase_id] = prompt_id
        self.seller_of[purchase_id] = seller
        self.price_wei_of[purchase_id] = listing_price
        self.exists_of[purchase_id] = True

        # O(1) ownership guard + per-buyer index.
        self.purchased_flag[flag_key] = True
        owned = self.buyer_count.get(buyer_hex, u256(0))
        self.buyer_item[buyer_hex + ":" + str(int(owned))] = prompt_id
        self.buyer_count[buyer_hex] = owned + u256(1)

        # Local sales + volume stats.
        if prompt_id in self.sales_count:
            self.sales_count[prompt_id] = self.sales_count[prompt_id] + u256(1)
        else:
            self.sales_count[prompt_id] = u256(1)
        self.total_sales_count = self.total_sales_count + u256(1)
        self.total_volume_wei = self.total_volume_wei + listing_price
        self.platform_balance = self.platform_balance + fee
        self.next_purchase_id = purchase_id + u256(1)

        # Push payment to the seller (native GEN). Fee stays in the contract.
        gl.chain.Account(seller).emit_transfer(value=proceeds)

        # One atomic Registry message: record the purchaser receipt (which
        # gates content delivery) AND bump the registry sales counter.
        registry.emit().record_purchase(buyer_hex, prompt_id)

        return purchase_id

    # ---------- WITHDRAW (owner only) ----------

    @gl.public.write
    def platform_withdraw(self) -> u256:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("only owner")
        amount = self.platform_balance
        if amount == u256(0):
            raise gl.vm.UserError("no platform fees to withdraw")
        self.platform_balance = u256(0)
        gl.chain.Account(self.owner).emit_transfer(value=amount)
        return amount

    # ---------- READ VIEWS ----------

    @gl.public.view
    def has_purchased(self, buyer: Address, prompt_id: u256) -> bool:
        buyer_hex = str(buyer.as_hex).lower()
        flag_key = buyer_hex + ":" + str(int(prompt_id))
        return flag_key in self.purchased_flag

    @gl.public.view
    def get_purchase(self, purchase_id: u256) -> dict[str, typing.Any]:
        if purchase_id not in self.exists_of:
            return {"exists": False}
        return {
            "exists": True,
            "id": purchase_id,
            "buyer": str(self.buyer_of[purchase_id].as_hex),
            "prompt_id": self.prompt_id_of[purchase_id],
            "seller": str(self.seller_of[purchase_id].as_hex),
            "price_wei": self.price_wei_of[purchase_id],
        }

    @gl.public.view
    def get_sales_count(self, prompt_id: u256) -> u256:
        if prompt_id not in self.sales_count:
            return u256(0)
        return self.sales_count[prompt_id]

    @gl.public.view
    def get_buyer_purchases(self, buyer: Address) -> list[u256]:
        out: list[u256] = []
        buyer_hex = str(buyer.as_hex).lower()
        owned = int(self.buyer_count.get(buyer_hex, u256(0)))
        i = 0
        while i < owned:
            key = buyer_hex + ":" + str(i)
            if key in self.buyer_item:
                out.append(self.buyer_item[key])
            i = i + 1
        return out

    @gl.public.view
    def get_stats(self) -> dict[str, typing.Any]:
        return {
            "total_volume_wei": self.total_volume_wei,
            "total_sales_count": self.total_sales_count,
            "platform_balance": self.platform_balance,
            "platform_fee_bps": self.platform_fee_bps,
            "owner": str(self.owner.as_hex),
            "registry_address": str(self.registry_address.as_hex),
        }

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner.as_hex)

    @gl.public.view
    def get_registry_address(self) -> str:
        return str(self.registry_address.as_hex)

    @gl.public.view
    def get_next_purchase_id(self) -> u256:
        return self.next_purchase_id
