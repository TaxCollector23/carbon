# @carbon/example-sdk-with-ai

Extends [`@carbon/example-sdk-basic`](../sdk-basic) with AI enrichment: the
IR is passed through `AiCapabilities` to infer resources/relationships, then
`AiJudge` scores that inference, and `replica.assertQuality()` gates the run
on the judge's minimum score.

## Run it

```bash
pnpm install

# Fully offline — uses an inline MockAiProvider.
pnpm --filter @carbon/example-sdk-with-ai dev

# Live — routes calls through Anthropic.
CARBON_AI_API_KEY=sk-ant-... pnpm --filter @carbon/example-sdk-with-ai dev
```

The offline path is not a hack — it implements `AiProvider` and runs the
caller's Zod schema exactly like a live provider does, so the code path
downstream is identical.

## What to copy

- **Provider swap** — construct whichever provider you want (Anthropic,
  OpenAI, OpenRouter, Gemini, Local, or your own) and hand it to
  `AiCapabilities` + `AiJudge`.
- **`ai:` in `emulate()`** — enrichment runs _before_ the graph is built,
  so inferred resources flow through the rest of the pipeline unchanged.
- **`replica.assertQuality(threshold?)`** — throws `CarbonError` with
  code `CARBON_AI_QUALITY_BELOW_THRESHOLD` when the judge's minimum score
  is under the gate. Wrap in `try/catch` to surface issues without killing
  the process.

## See also

- `packages/ai/src/judge.ts` — verdict shape and severities.
- `packages/sdk/src/index.ts` — the `EmulateAiOptions` contract.
