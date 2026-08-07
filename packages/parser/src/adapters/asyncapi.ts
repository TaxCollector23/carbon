import { ParseFailedError } from '@carbon/core';
import { parse as parseYaml } from 'yaml';
import type {
  EndpointDef,
  EndpointId,
  HttpMethod,
  IntermediateRepresentation,
  JsonType,
  ParamDef,
  ResourceDef,
  ResourceId,
  ResponseDef,
} from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';
import { isRecord, jsonSchemaToJsonType, resolveLocalRef } from './schema.js';

type AsyncAction = 'publish' | 'subscribe' | 'send' | 'receive';

const METHOD_BY_ACTION: Record<AsyncAction, HttpMethod> = {
  publish: 'POST',
  send: 'POST',
  subscribe: 'GET',
  receive: 'GET',
};

/**
 * AsyncAPI adapter scaffold.
 *
 * Carbon's current IR is HTTP-shaped, so message flows are represented as
 * deterministic pseudo-endpoints under `/asyncapi/...` and the native channel,
 * action, and message details are preserved in endpoint metadata.
 */
export class AsyncApiParser implements Parser {
  readonly name = 'asyncapi';
  readonly formats = ['asyncapi'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'asyncapi') return true;
    if (input.kind === 'json') {
      return typeof (input.content as { asyncapi?: unknown } | null)?.asyncapi === 'string';
    }
    if (input.kind === 'text') {
      const trimmed = input.content.trim();
      return (
        (trimmed.startsWith('{') && /"asyncapi"\s*:/.test(trimmed)) ||
        /^\s*asyncapi\s*:/m.test(input.content)
      );
    }
    return false;
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    const doc = normalize(input);
    if (!isRecord(doc)) throw new ParseFailedError('AsyncAPI root must be an object');

    const info = isRecord(doc.info) ? doc.info : {};
    const resources = new Map<string, ResourceDef>();
    const endpoints: EndpointDef[] = [];

    for (const operation of collectOperations(doc)) {
      const message = firstMessage(operation.operation, doc);
      const payload = messagePayload(message, doc);
      const payloadType: JsonType = payload
        ? jsonSchemaToJsonType(payload, doc)
        : { kind: 'unknown' };
      const resourceName = inferResourceName(message, operation.channelAddress);
      const resourceId = resourceName ? asResourceId(normalizeResourceId(resourceName)) : null;

      if (resourceName && resourceId && !resources.has(String(resourceId))) {
        resources.set(String(resourceId), {
          id: resourceId,
          name: pascalCase(resourceName),
          primaryKey: 'id',
          schema: payloadType,
        });
      }

      const method = METHOD_BY_ACTION[operation.action];
      const path = toAsyncPath(operation.channelAddress);
      const endpointId = `${method}:${path}:${operation.action}` as EndpointId;
      const responses: ResponseDef[] =
        method === 'GET' ? [{ status: 200, body: payloadType, headers: {} }] : [];

      endpoints.push({
        id: endpointId,
        method,
        path,
        operation: 'action',
        resource: resourceId,
        params: extractChannelParams(operation.channelAddress),
        requestBody: method === 'POST' ? payloadType : null,
        responses,
        auth: [],
        meta: {
          asyncapi: {
            action: operation.action,
            channel: operation.channelName,
            operationId: operation.operationId,
            message: messageName(message),
          },
        },
      });
    }

    return {
      version: 1,
      api: {
        name: stringValue(info.title) ?? 'AsyncAPI',
        version: stringValue(info.version) ?? '0.0.0',
        source: { kind: 'asyncapi', origin: ctx.origin, ingestedAt: 0 },
      },
      servers: extractServers(doc),
      auth: [],
      resources: Array.from(resources.values()),
      endpoints,
      relationships: [],
      examples: [],
      meta: {
        asyncapiVersion: stringValue(doc.asyncapi),
        channelCount: isRecord(doc.channels) ? Object.keys(doc.channels).length : 0,
      },
    };
  }
}

interface CollectedOperation {
  readonly action: AsyncAction;
  readonly channelName: string;
  readonly channelAddress: string;
  readonly operationId?: string;
  readonly operation: Record<string, unknown>;
}

function collectOperations(doc: Record<string, unknown>): CollectedOperation[] {
  const out: CollectedOperation[] = [];
  const channels = isRecord(doc.channels) ? doc.channels : {};

  for (const [channelName, rawChannel] of Object.entries(channels)) {
    const channel = resolveLocalRef(rawChannel, doc);
    if (!isRecord(channel)) continue;
    const channelAddress = stringValue(channel.address) ?? channelName;
    for (const action of ['publish', 'subscribe'] as const) {
      const operation = resolveLocalRef(channel[action], doc);
      if (!isRecord(operation)) continue;
      out.push({
        action,
        channelName,
        channelAddress,
        operationId: stringValue(operation.operationId),
        operation,
      });
    }
  }

  const operations = isRecord(doc.operations) ? doc.operations : {};
  for (const [operationName, rawOperation] of Object.entries(operations)) {
    const operation = resolveLocalRef(rawOperation, doc);
    if (!isRecord(operation)) continue;
    const action =
      operation.action === 'receive' ? 'receive' : operation.action === 'send' ? 'send' : null;
    if (!action) continue;

    const channel = resolveLocalRef(operation.channel, doc);
    const channelName = channelNameFromRef(operation.channel) ?? operationName;
    const channelAddress = isRecord(channel)
      ? (stringValue(channel.address) ?? channelName)
      : channelName;
    out.push({
      action,
      channelName,
      channelAddress,
      operationId: stringValue(operation.operationId) ?? operationName,
      operation,
    });
  }

  return out;
}

function firstMessage(operation: Record<string, unknown>, root: Record<string, unknown>): unknown {
  const message = resolveLocalRef(operation.message, root);
  if (isRecord(message)) return message;

  const messages = operation.messages;
  if (Array.isArray(messages)) {
    for (const candidate of messages) {
      const resolved = resolveLocalRef(candidate, root);
      if (isRecord(resolved)) return resolved;
    }
  }

  return null;
}

function messagePayload(message: unknown, root: Record<string, unknown>): unknown {
  if (!isRecord(message)) return null;
  return resolveLocalRef(message.payload, root);
}

function inferResourceName(message: unknown, channelAddress: string): string | null {
  const fromMessage = messageName(message);
  if (fromMessage) return fromMessage;
  const segments = channelAddress
    .split(/[/.]/)
    .map((segment) => segment.replace(/[{}]/g, ''))
    .filter(Boolean);
  const last = segments[segments.length - 1];
  return last ?? null;
}

function extractServers(doc: Record<string, unknown>): IntermediateRepresentation['servers'] {
  const servers = doc.servers;
  if (!isRecord(servers)) return [];
  const out: Array<{ url: string; description?: string }> = [];
  for (const [name, server] of Object.entries(servers)) {
    const resolved = resolveLocalRef(server, doc);
    if (!isRecord(resolved)) continue;
    const url = stringValue(resolved.url);
    if (!url) continue;
    out.push({
      url,
      description: stringValue(resolved.description) ?? name,
    });
  }
  return out;
}

function extractChannelParams(channelAddress: string): ParamDef[] {
  const params: ParamDef[] = [];
  const seen = new Set<string>();
  for (const match of channelAddress.matchAll(/\{([^}/]+)\}/g)) {
    const name = match[1];
    if (!name || seen.has(name)) continue;
    seen.add(name);
    params.push({ name, in: 'path', required: true, schema: { kind: 'string' } });
  }
  return params;
}

function toAsyncPath(channelAddress: string): string {
  const normalized = channelAddress
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-');
  return normalized ? `/asyncapi/${normalized}` : '/asyncapi/messages';
}

function messageName(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  return stringValue(message.name) ?? stringValue(message.title);
}

function channelNameFromRef(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.$ref !== 'string') return undefined;
  const match = /^#\/channels\/(.+)$/.exec(value.$ref);
  return match?.[1]?.replace(/~1/g, '/').replace(/~0/g, '~');
}

function normalize(input: ParserInput): unknown {
  if (input.kind === 'json') return input.content;
  if (input.kind === 'text') {
    try {
      return JSON.parse(input.content);
    } catch {
      try {
        return parseYaml(input.content);
      } catch (cause) {
        throw new ParseFailedError('AsyncAPI document is not valid JSON or YAML', cause);
      }
    }
  }
  throw new ParseFailedError('AsyncAPI parser cannot read binary input directly');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeResourceName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeResourceId(name: string): string {
  return normalizeResourceName(name).toLowerCase();
}

function pascalCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

function asResourceId(name: string): ResourceId {
  return name as ResourceId;
}
