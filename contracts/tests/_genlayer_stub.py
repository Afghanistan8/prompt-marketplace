"""
Minimal stand-in for the `genlayer` GenVM SDK, sufficient to import and run
contracts/PromptRegistry.py as plain Python for local testing.

This is NOT a GenVM simulator. It does not model consensus, validator
voting, or -- most importantly for what this test suite proves --
transaction signature verification. `gl.message.sender_address` is just a
plain mutable attribute here that a test sets directly before calling a
contract method.

That is a deliberate scope boundary, not an oversight: on real GenVM
Bradbury, a @gl.public.view call's `from` is a caller-supplied RPC
parameter with no signature behind it (spoofable), while a
@gl.public.write's gl.message.sender_address is derived from a real,
validator-verified ECDSA signature over the submitted transaction (not
spoofable) -- see frontend/node_modules/genlayer-js: reads go out via an
unauthenticated `gen_call`, writes are signed with `account.signTransaction`
before being broadcast. That asymmetry lives in the GenVM/chain layer, not
in contract code, so no contract-level unit test (this one included) can
exercise it directly. What this test suite CAN and does prove, against the
real contracts/PromptRegistry.py source:

  1. No @gl.public.view method returns the plaintext body under ANY
     sender_address, including a real purchaser's address handed to it by
     someone else (the exact "raw read" spoofing scenario in the steward
     feedback) -- because no view function touches body content at all
     anymore.
  2. claim_body's authorization logic (seller-or-receipt) is correct given
     whatever sender_address GenVM attributes to the caller.

Point 2 combined with GenVM's real (external, protocol-level) signature
verification is what closes the loop. See docs/ARCHITECTURE.md.
"""

import sys
import types


class UserError(Exception):
    pass


class Address:
    def __init__(self, value):
        if isinstance(value, Address):
            value = value._hex
        h = str(value).lower()
        if not h.startswith("0x"):
            h = "0x" + h
        self._hex = h

    @property
    def as_hex(self):
        return self._hex

    def __eq__(self, other):
        if not isinstance(other, Address):
            return NotImplemented
        return self._hex == other._hex

    def __hash__(self):
        return hash(self._hex)

    def __repr__(self):
        return f"Address({self._hex})"


class u256(int):
    def __new__(cls, value=0):
        return int.__new__(cls, int(value))

    def __add__(self, other):
        return u256(int(self) + int(other))

    def __sub__(self, other):
        return u256(int(self) - int(other))

    def __mul__(self, other):
        return u256(int(self) * int(other))

    def __floordiv__(self, other):
        return u256(int(self) // int(other))


class TreeMap(dict):
    @classmethod
    def __class_getitem__(cls, item):
        return cls


def _default_for(field_type):
    if field_type is TreeMap:
        return TreeMap()
    if field_type is u256:
        return u256(0)
    if field_type is str:
        return ""
    if field_type is bool:
        return False
    return None


class Contract:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        original_init = cls.__dict__.get("__init__")
        # Python 3.14 (PEP 649) evaluates class annotations lazily; reading
        # them via cls.__dict__["__annotations__"] can come back empty/None.
        # Attribute access on the class goes through the lazy-annotation
        # machinery correctly on both old and new Python.
        annotations = dict(getattr(cls, "__annotations__", None) or {})

        def wrapped_init(self, *args, **kwargs):
            for field_name, field_type in annotations.items():
                if field_name not in self.__dict__:
                    self.__dict__[field_name] = _default_for(field_type)
            if original_init is not None:
                original_init(self, *args, **kwargs)

        cls.__init__ = wrapped_init


class _Message:
    def __init__(self):
        self.sender_address = None
        self.value = u256(0)


class _Vm:
    UserError = UserError


def _default_exec_prompt(task: str) -> str:
    # categorize()'s template JSON schema contains "category" but not
    # "verdict"; duplicate_check()'s contains "verdict". Good enough to
    # discriminate the two templates without inspecting the whole prompt.
    if '"verdict"' in task:
        return '{"verdict": "UNIQUE", "duplicate_of": 0}'
    return '{"category": "other"}'


class _EqPrinciple:
    @staticmethod
    def strict_eq(fn):
        return fn()


class _WriteDecorator:
    def __call__(self, fn):
        return fn

    @property
    def payable(self):
        return self


def _contract_interface(cls):
    return cls


gl = types.SimpleNamespace(
    Contract=Contract,
    message=_Message(),
    vm=_Vm(),
    nondet=types.SimpleNamespace(exec_prompt=_default_exec_prompt),
    eq_principle=_EqPrinciple(),
    public=types.SimpleNamespace(write=_WriteDecorator(), view=lambda fn: fn),
    contract_interface=_contract_interface,
    evm=types.SimpleNamespace(contract_interface=_contract_interface),
)

genlayer_module = types.ModuleType("genlayer")
genlayer_module.gl = gl
genlayer_module.Address = Address
genlayer_module.u256 = u256
genlayer_module.TreeMap = TreeMap
genlayer_module.Contract = Contract

sys.modules["genlayer"] = genlayer_module
