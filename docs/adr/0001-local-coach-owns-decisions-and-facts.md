# Local Coach owns decisions and facts

MaxPower keeps deterministic planning, policy, tool execution and authoritative facts in the local Product Kernel, while Pi owns the only Agent loop. This keeps auditable writes and shared product behaviour identical. The core MVP uses a text-only LLM Provider and a single-device repository so Profile → Plan → Timeline/Workout/Nutrition/Recovery → Replan can be validated without moving product data to a server. Neither a remote Provider nor an SDK hook is the safety or transaction seam.
