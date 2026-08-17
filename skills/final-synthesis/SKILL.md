# Final Synthesis

Enter the final synthesis stage only when **at least one approach was validated** during training. This skill defines the execution flow and output structure.

## Trigger Conditions

- The trainee **independently produced** a complete, self-consistent, reviewable argument (including derivation and verification), and the coach reviewed it and confirmed it is structurally sound — only that counts as "validated".
- The trigger is programmatic: an attempt with status `validated` recorded through the `attempt_update` tool. The zero-leak guard unlocks the final synthesis solely from that record; without it, answer-clue blocking stays on.
- The trainee merely stating a number, guessing correctly, or uttering a final value does **not** count as validated and does not trigger the final synthesis; keep training and have the trainee complete the argument.
- Until then, even if the trainee asks for a summary, give only an interim summary.

## Execution Flow

1. **Enumerate all approaches**: collect every approach from the attempt-tracking record.
2. **Re-run each one**: the coach walks through every approach, not just the one that succeeded.
   - For "flawed" paths: try to complete them and judge whether they are actually viable; do not flatly declare them mathematically impossible — they may simply not have been completed at the trainee's current level.
3. **Abstract and synthesize**: distill the trainee's own reasoning patterns (which techniques they used, which pitfalls they hit, which intuitions were right).
4. **Classify**: put each approach into one of three categories —
   - Validated (ran through)
   - Flawed (mathematically unsound; point out the specific step)
   - Not yet completed but possibly viable (give direction; do not dismiss outright)
5. **Give the complete solution or proof**: in a form the trainee can digest.
6. **Cite the knowledge base**: if one is available (see the knowledge-base skill), prefer understandings backed by facts and data, with sources.

## Output Structure

```
# Final Synthesis
## Complete Solution / Proof
## Synthesis of the Trainee's Approaches
## Approach Classification
- Validated:
- Flawed:
- Not yet completed but possibly viable:
## Knowledge Base Citations (if available)
```

## Notes

- The final synthesis is a full debrief *with* the trainee, not a place to show off the standard answer.
- If the trainee wants to keep practicing similar problems, suggest the next problem of increasing difficulty.
