# v0.1.6 - adds gl.chain.Account(addr).emit_transfer for seller/platform withdrawals
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *

import typing


class PromptEscrow(gl.Contract):
    owner: Address
    platform_fee_bps: u256
    next_purchase_id: u256
    platform_balance: u256
    total_volume_wei: u256
    total_sales_count: u256

    buyer_of: TreeMap[u256, Address]
    prompt_id_of: TreeMap[u256, u256]
    seller_of: TreeMap[u256, Address]
    price_wei_of: TreeMap[u256, u256]
    exists_of: TreeMap[u256, bool]

    sales_count: TreeMap[u256, u256]

    def __init__(self, platform_fee_bps: u256):
        self.owner = gl.message.sender_address
        self.platform_fee_bps = platform_fee_bps
        self.next_purchase_id = u256(1)
        self.platform_balance = u256(0)
        self.total_volume_wei = u256(0)
        self.total_sales_count = u256(0)

    @gl.public.write.payable
    def buy(self, prompt_id: u256, seller: Address, price_wei: u256) -> u256:
        if gl.message.value != price_wei:
            raise gl.vm.UserError("attached value does not match price")
        if price_wei == u256(0):
            raise gl.vm.UserError("price must be positive")

        buyer = gl.message.sender_address
        if buyer == seller:
            raise gl.vm.UserError("seller cannot buy own listing")

        purchase_id = self.next_purchase_id

        # Compute split
        fee = (price_wei * self.platform_fee_bps) // u256(10000)
        proceeds = price_wei - fee

        # Forward seller proceeds immediately (push-payment pattern)
        # NEW in v0.1.6: native GEN transfer to the seller's address
        gl.chain.Account(seller).emit_transfer(value=proceeds)

        # Platform fee stays in contract, owner can withdraw later
        self.platform_balance = self.platform_balance + fee

        self.buyer_of[purchase_id] = buyer
        self.prompt_id_of[purchase_id] = prompt_id
        self.seller_of[purchase_id] = seller
        self.price_wei_of[purchase_id] = price_wei
        self.exists_of[purchase_id] = True

        if prompt_id in self.sales_count:
            self.sales_count[prompt_id] = self.sales_count[prompt_id] + u256(1)
        else:
            self.sales_count[prompt_id] = u256(1)

        self.total_sales_count = self.total_sales_count + u256(1)
        self.total_volume_wei = self.total_volume_wei + price_wei
        self.next_purchase_id = purchase_id + u256(1)

        return purchase_id

    # NEW in v0.1.6: owner withdraws accumulated platform fees
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
    def get_stats(self) -> dict[str, typing.Any]:
        return {
            "total_volume_wei": self.total_volume_wei,
            "total_sales_count": self.total_sales_count,
            "platform_balance": self.platform_balance,
            "platform_fee_bps": self.platform_fee_bps,
            "owner": str(self.owner.as_hex),
        }

    @gl.public.view
    def get_owner(self) -> str:
        return str(self.owner.as_hex)

    @gl.public.view
    def get_next_purchase_id(self) -> u256:
        return self.next_purchase_id

    @gl.public.view
    def has_purchased(self, buyer: Address, prompt_id: u256) -> bool:
        last = int(self.next_purchase_id) - 1
        i = 1
        while i <= last:
            pid = u256(i)
            if pid in self.exists_of:
                if self.buyer_of[pid] == buyer and self.prompt_id_of[pid] == prompt_id:
                    return True
            i = i + 1
        return False

    @gl.public.view
    def get_buyer_purchases(self, buyer: Address) -> list[u256]:
        out: list[u256] = []
        last = int(self.next_purchase_id) - 1
        i = 1
        while i <= last:
            pid = u256(i)
            if pid in self.exists_of:
                if self.buyer_of[pid] == buyer:
                    out.append(self.prompt_id_of[pid])
            i = i + 1
        return out
