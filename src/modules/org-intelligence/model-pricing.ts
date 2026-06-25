/**
 * Approximate frontier model pricing in USD per 1,000,000 tokens (input,
 * output). Used by the budget governor to estimate month-to-date spend and
 * decide when to force the downgrade ladder. These are list prices and only
 * need to be roughly right — they gate behaviour, they are not an invoice.
 *
 * Self-hosted / local models cost $0 (no API charge), so they are omitted and
 * resolve to the zero default.
 */
interface Price {
  inputPerM: number;
  outputPerM: number;
}

const PRICES: Array<{ match: RegExp; price: Price }> = [
  // OpenAI
  { match: /gpt-4o-mini/i, price: { inputPerM: 0.15, outputPerM: 0.6 } },
  { match: /gpt-4o/i, price: { inputPerM: 2.5, outputPerM: 10 } },
  { match: /gpt-4\.1-mini/i, price: { inputPerM: 0.4, outputPerM: 1.6 } },
  { match: /gpt-4\.1/i, price: { inputPerM: 2, outputPerM: 8 } },
  { match: /o3-mini|o4-mini/i, price: { inputPerM: 1.1, outputPerM: 4.4 } },
  // Anthropic
  { match: /haiku/i, price: { inputPerM: 0.8, outputPerM: 4 } },
  { match: /sonnet/i, price: { inputPerM: 3, outputPerM: 15 } },
  { match: /opus/i, price: { inputPerM: 15, outputPerM: 75 } },
];

/** Per-1M (input, output) price for a model id, or null when unknown/local. */
export function priceFor(model: string): Price | null {
  if (!model) return null;
  // Local / self-hosted tiers are free.
  if (/^(ollama|local|claude-code|codex)/i.test(model)) return null;
  if (/llama|qwen|mistral|gemma|phi|nomic/i.test(model)) return null;
  for (const { match, price } of PRICES) {
    if (match.test(model)) return price;
  }
  return null;
}

/** Estimate the USD cost of a completion. Unknown/local models cost $0. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = priceFor(model);
  if (!price) return 0;
  return (
    (Math.max(0, inputTokens) / 1_000_000) * price.inputPerM +
    (Math.max(0, outputTokens) / 1_000_000) * price.outputPerM
  );
}

/** A model is a paid frontier model when we have a non-zero price for it. */
export function isFrontierModel(model: string): boolean {
  return priceFor(model) !== null;
}
