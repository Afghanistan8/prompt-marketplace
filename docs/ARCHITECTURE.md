# Architecture Notes

## Contract interaction flow

`
Seller -> PromptRegistry.list_prompt()
            |
            +-> gl.eq_principle.prompt_comparative (duplicate check)
            +-> gl.eq_principle.prompt_comparative (category + tags)
            |
            v
         Listing stored (or rejected with reason)

Buyer -> PromptEscrow.buy(prompt_id) [sends GEN]
            |
            +-> Reads PromptRegistry.get_listing()
            +-> Transfers GEN to seller (minus fee)
            +-> Calls PromptRegistry.increment_sales()
            +-> Emits Receipt event (Lit reads this for decryption)

Buyer -> PromptEscrow.dispute(prompt_id, reason)
            |
            +-> QualityOracle.judge(prompt_id, reason)
                  |
                  +-> Re-runs prompt with test inputs (gl.nondet.exec_prompt)
                  +-> LLM compares output vs listing description
                  +-> Refund or reject via eq_principle
`

## Why each contract is GenLayer-native

| Contract          | Intelligent primitive used                          |
|-------------------|-----------------------------------------------------|
| PromptRegistry    | eq_principle.prompt_comparative x2 (dupes + tags)   |
| PromptEscrow      | Deterministic (no LLM needed for payment logic)     |
| ReputationLedger  | nondet.exec_prompt (sanity-check review text)       |
| QualityOracle     | eq_principle.prompt_comparative (dispute verdict)   |

Three of four contracts use LLM-in-contract as load-bearing logic.
This is the Builder Program defensibility story.
