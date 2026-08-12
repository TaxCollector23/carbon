import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockAiProvider, pathToResourceName } from './mock.js';

const ResourceSchema = z.object({
  resources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      primaryKey: z.string(),
      schema: z.object({ kind: z.literal('unknown') }),
    }),
  ),
});

const JudgeSchema = z.object({ score: z.number().min(0).max(1), issues: z.array(z.unknown()) });

const NarrowSchema = z.object({ carbonSpecific: z.literal('only-thing-that-fits') });

const IR = {
  ir: {
    endpoints: [
      { path: '/pets' },
      { path: '/pets/{id}/tags' },
      { path: '/api/v1/categories' },
    ],
  },
};

describe('MockAiProvider', () => {
  it('infers resources deterministically from IR endpoint paths', async () => {
    const p = new MockAiProvider();
    const out = await p.structured({
      instruction: 'Infer resources for this IR',
      input: IR,
      schema: ResourceSchema,
    });
    const names = out.resources.map((r) => r.name).sort();
    expect(names).toEqual(['api_v1_category', 'pet', 'pet_tag']);
  });

  it('returns a passing judge verdict by default', async () => {
    const p = new MockAiProvider();
    const out = await p.structured({
      instruction: 'Judge whether the proposed resources are grounded',
      input: {},
      schema: JudgeSchema,
    });
    expect(out.score).toBe(0.9);
    expect(out.issues).toEqual([]);
  });

  it('respects reply() overrides for schema-matching responses', async () => {
    const p = new MockAiProvider();
    p.reply('judge', { score: 0.4, issues: [{ path: 'x' }] });
    const out = await p.structured({
      instruction: 'judge quality',
      input: {},
      schema: JudgeSchema,
    });
    expect(out.score).toBe(0.4);
    expect(out.issues).toHaveLength(1);
  });

  it('skips overrides whose response fails schema validation and falls back to a candidate', async () => {
    const p = new MockAiProvider();
    p.reply('judge', { score: 'not-a-number' }); // invalid
    const out = await p.structured({
      instruction: 'judge quality',
      input: {},
      schema: JudgeSchema,
    });
    expect(out.score).toBe(0.9); // fallback candidate
  });

  it('throws a helpful error when no candidate satisfies the requested schema', async () => {
    const p = new MockAiProvider();
    await expect(
      p.structured({
        instruction: 'ask something the mock has no answer for',
        input: {},
        schema: NarrowSchema,
      }),
    ).rejects.toThrow(/no built-in candidate matched/);
  });

  it('complete() returns a shape-conformant CompletionResponse', async () => {
    const p = new MockAiProvider();
    const out = await p.complete({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(out.model).toBe('mock-1');
    expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    expect(out.text).toMatch(/^mock completion:/);
  });
});

describe('pathToResourceName', () => {
  it.each([
    ['/pets', 'pet'],
    ['/pets/{id}/tags', 'pet_tag'],
    ['/pets/:id/tags', 'pet_tag'],
    ['/api/v1/users', 'api_v1_user'],
    ['/companies', 'company'],
    ['/classes', 'class'], // tiny singularizer strips 'es' from 'sses' endings
    ['/status', 'status'],
    ['/', null],
    ['/{id}', null],
  ])('%s → %s', (input, expected) => {
    expect(pathToResourceName(input)).toBe(expected);
  });
});
