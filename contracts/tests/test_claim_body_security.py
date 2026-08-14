"""
Proof, against the real contracts/PromptRegistry.py source, that the
Bradbury read-spoofing hole from the steward feedback is closed:

    "full prompt delivery is still bypassable because Bradbury read `from`
    can be spoofed and the body is stored in plaintext"

Three things are demonstrated below:

  1. test_body_never_stored_in_plaintext -- the plaintext body never touches
     contract state; only ciphertext does.
  2. test_no_view_method_ever_leaks_the_body -- EVERY @gl.public.view method
     on PromptRegistry is called with the real purchaser's address handed to
     it as the (spoofable) sender -- i.e. exactly the "raw read... supplying
     a purchaser's address" attack the steward described -- and none of them
     ever return the body, because none of them touch body content at all.
  3. test_unpaid_caller_cannot_claim / test_real_buyer_and_seller_can_claim --
     the authenticated write claim_body() only ever returns the decrypted
     body to the seller or a wallet with a real purchase receipt; an unpaid
     caller acting as themselves gets a UserError and nothing else.

See _genlayer_stub.py for exactly what this harness does and does not model
(short version: it does not simulate GenVM's transaction-signature
verification, because that lives in the chain layer, not in contract code --
see that file's docstring for the full boundary).

Run with: python -m pytest contracts/tests/ -v
"""

import importlib
import os
import sys

import pytest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
CONTRACTS_DIR = os.path.abspath(os.path.join(TESTS_DIR, ".."))

sys.path.insert(0, TESTS_DIR)
import _genlayer_stub as stub  # noqa: E402

sys.path.insert(0, CONTRACTS_DIR)

SELLER = stub.Address("0x1111111111111111111111111111111111111111")
BUYER = stub.Address("0x2222222222222222222222222222222222222222")
ATTACKER = stub.Address("0x3333333333333333333333333333333333333333")
ESCROW = stub.Address("0x9999999999999999999999999999999999999999")

BODY = (
    "You are a helpful assistant. Always answer in exactly three bullet "
    "points, no more, no less, and never break character."
)

# Every @gl.public.view PromptRegistry declares, and how to call each one.
VIEW_CALLS = {
    "get_listing": lambda registry, mod, prompt_id: registry.get_listing(prompt_id),
    "get_all_active": lambda registry, mod, prompt_id: registry.get_all_active(mod.u256(50)),
    "get_next_id": lambda registry, mod, prompt_id: registry.get_next_id(),
    "get_owner": lambda registry, mod, prompt_id: registry.get_owner(),
    "get_escrow": lambda registry, mod, prompt_id: registry.get_escrow(),
    "get_listing_seller_hex": lambda registry, mod, prompt_id: registry.get_listing_seller_hex(prompt_id),
    "get_listing_price_wei": lambda registry, mod, prompt_id: registry.get_listing_price_wei(prompt_id),
    "get_listing_status": lambda registry, mod, prompt_id: registry.get_listing_status(prompt_id),
}


def _load_registry_module():
    if "PromptRegistry" in sys.modules:
        del sys.modules["PromptRegistry"]
    return importlib.import_module("PromptRegistry")


def _new_registry(mod):
    stub.gl.message.sender_address = SELLER
    registry = mod.PromptRegistry()
    stub.gl.message.sender_address = SELLER
    registry.set_escrow_contract(ESCROW)
    return registry


def _list_prompt(registry, mod):
    stub.gl.message.sender_address = SELLER
    return registry.list_prompt(
        title="Three Bullet Summarizer",
        description="Summarizes any input text into exactly three crisp bullet points for busy readers.",
        target_models_csv="gpt-4o,claude-3.7",
        price_wei=mod.u256(1000),
        ipfs_cid="bafyplaceholder",
        body_hash="0" * 64,
        preview="Summarize into three bullets.",
        body=BODY,
    )


def _settle_real_purchase(registry, prompt_id):
    # Exactly what a real, paid PromptEscrow.buy() triggers: escrow (and
    # only escrow, per the `only escrow` guard) writes the buyer's receipt.
    stub.gl.message.sender_address = ESCROW
    registry.record_purchase(str(BUYER.as_hex).lower(), prompt_id)


@pytest.fixture
def mod():
    return _load_registry_module()


def test_body_never_stored_in_plaintext(mod):
    registry = _new_registry(mod)
    prompt_id = _list_prompt(registry, mod)

    ciphertext_hex = registry.body_ciphertext_of[prompt_id]

    assert BODY not in ciphertext_hex
    assert BODY.encode("utf-8").hex() not in ciphertext_hex
    assert not hasattr(registry, "body_of")
    assert ciphertext_hex != ""


def test_no_view_method_ever_leaks_the_body(mod):
    registry = _new_registry(mod)
    prompt_id = _list_prompt(registry, mod)
    _settle_real_purchase(registry, prompt_id)

    # The vulnerable method must be completely gone, not merely locked down.
    assert not hasattr(mod.PromptRegistry, "get_purchased_body")
    assert not hasattr(mod.PromptRegistry, "get_body")

    for name, call in VIEW_CALLS.items():
        assert hasattr(mod.PromptRegistry, name), f"expected view {name} to exist"
        for spoofed_from in (BUYER, SELLER, ATTACKER):
            # This is the steward's exact scenario: a raw read with `from`
            # set to a REAL purchaser's address, by someone who is not that
            # purchaser (unauthenticated on a view -- entirely legal to set
            # to any value here, which is the point).
            stub.gl.message.sender_address = spoofed_from
            try:
                result = call(registry, mod, prompt_id)
            except Exception:
                continue
            serialized = str(result)
            assert BODY not in serialized, (
                f"{name} leaked the plaintext body under spoofed sender {spoofed_from.as_hex}"
            )
            assert registry.body_ciphertext_of[prompt_id] not in serialized


def test_unpaid_caller_cannot_claim_even_with_purchasers_address(mod):
    registry = _new_registry(mod)
    prompt_id = _list_prompt(registry, mod)
    _settle_real_purchase(registry, prompt_id)

    # The attacker never paid. They know BUYER's address (it's public -- it's
    # right there in the receipt / on any block explorer) but claim_body is a
    # WRITE: sender_address here stands in for what GenVM derives from a real
    # signed transaction, which the attacker cannot produce for BUYER's key.
    # Modeling the attacker honestly, as themselves:
    stub.gl.message.sender_address = ATTACKER
    with pytest.raises(stub.UserError):
        registry.claim_body(prompt_id)

    # And an attacker who never bought anything gets nothing even for a
    # listing nobody has purchased yet.
    stub.gl.message.sender_address = SELLER
    other_prompt_id = _list_prompt(registry, mod)
    stub.gl.message.sender_address = ATTACKER
    with pytest.raises(stub.UserError):
        registry.claim_body(other_prompt_id)


def test_real_buyer_and_seller_can_claim_the_correct_body(mod):
    registry = _new_registry(mod)
    prompt_id = _list_prompt(registry, mod)
    _settle_real_purchase(registry, prompt_id)

    stub.gl.message.sender_address = BUYER
    assert registry.claim_body(prompt_id) == BODY

    stub.gl.message.sender_address = SELLER
    assert registry.claim_body(prompt_id) == BODY


def test_record_purchase_is_idempotent(mod):
    # The escrow emits record_purchase with on='accepted' so buyers can unlock
    # without waiting out the appeal window. GenLayer may re-deliver such a
    # message across appeal rounds, so a repeat delivery must not double-count
    # sales_count -- and must still leave the buyer able to claim.
    registry = _new_registry(mod)
    prompt_id = _list_prompt(registry, mod)

    _settle_real_purchase(registry, prompt_id)
    assert int(registry.sales_count_of[prompt_id]) == 1

    _settle_real_purchase(registry, prompt_id)
    _settle_real_purchase(registry, prompt_id)
    assert int(registry.sales_count_of[prompt_id]) == 1

    stub.gl.message.sender_address = BUYER
    assert registry.claim_body(prompt_id) == BODY


def test_claim_body_fails_before_any_purchase(mod):
    registry = _new_registry(mod)
    prompt_id = _list_prompt(registry, mod)

    stub.gl.message.sender_address = BUYER
    with pytest.raises(stub.UserError):
        registry.claim_body(prompt_id)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
