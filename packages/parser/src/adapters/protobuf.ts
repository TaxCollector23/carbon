import { ParseFailedError } from '@carbon/core';
import type {
  EndpointDef,
  EndpointId,
  IntermediateRepresentation,
  JsonType,
  ResourceDef,
  ResourceId,
} from '@carbon/types';
import type { Parser, ParserContext, ParserInput } from '../parser.js';

export interface ProtoDocument {
  readonly packageName?: string;
  readonly messages: readonly ProtoMessage[];
  readonly services: readonly ProtoService[];
}

export interface ProtoMessage {
  readonly name: string;
  readonly fields: readonly ProtoField[];
}

export interface ProtoField {
  readonly name: string;
  readonly type: string;
  readonly label?: 'optional' | 'repeated' | 'required';
  readonly tag: number;
}

export interface ProtoService {
  readonly name: string;
  readonly rpcs: readonly ProtoRpc[];
}

export interface ProtoRpc {
  readonly name: string;
  readonly requestType: string;
  readonly responseType: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
}

/**
 * Protobuf adapter scaffold.
 *
 * This intentionally parses schema shape from `.proto` text without invoking a
 * compiler. It captures messages as resources and service RPCs as gRPC-shaped
 * pseudo-endpoints so downstream Carbon stages can work with the API surface.
 */
export class ProtobufParser implements Parser {
  readonly name = 'protobuf';
  readonly formats = ['protobuf'] as const;

  canParse(input: ParserInput): boolean {
    if (input.hint === 'grpc') return false;
    if (input.hint === 'protobuf') return true;
    if (input.kind !== 'text') return false;
    return (
      /\bsyntax\s*=\s*"proto[23]"\s*;/.test(input.content) ||
      /\bmessage\s+\w+\s*\{/.test(input.content)
    );
  }

  async parse(input: ParserInput, ctx: ParserContext): Promise<IntermediateRepresentation> {
    if (input.kind !== 'text') {
      throw new ParseFailedError('Protobuf parser requires .proto text input');
    }
    const document = parseProtoDocument(input.content);
    return protoDocumentToIr(document, ctx, 'protobuf');
  }
}

export function parseProtoDocument(content: string): ProtoDocument {
  const source = stripComments(content);
  const packageName = /\bpackage\s+([A-Za-z_][\w.]*)\s*;/.exec(source)?.[1];
  return {
    packageName,
    messages: parseMessages(source),
    services: parseServices(source),
  };
}

export function protoDocumentToIr(
  document: ProtoDocument,
  ctx: ParserContext,
  sourceKind: 'protobuf' | 'grpc',
): IntermediateRepresentation {
  const resources = document.messages.map(messageToResource);
  const resourceNames = new Set(resources.map((resource) => String(resource.id)));
  const endpoints: EndpointDef[] = [];

  for (const service of document.services) {
    for (const rpc of service.rpcs) {
      const responseResource = normalizeTypeName(rpc.responseType);
      const requestResource = normalizeTypeName(rpc.requestType);
      const resource = resourceNames.has(responseResource)
        ? asResourceId(responseResource)
        : resourceNames.has(requestResource)
          ? asResourceId(requestResource)
          : null;

      const path = `/grpc/${service.name}/${rpc.name}`;
      endpoints.push({
        id: `POST:${path}` as EndpointId,
        method: 'POST',
        path,
        operation: 'action',
        resource,
        params: [],
        requestBody: { kind: 'ref', ref: rpc.requestType },
        responses: [{ status: 200, body: { kind: 'ref', ref: rpc.responseType }, headers: {} }],
        auth: [],
        meta: {
          grpc: {
            service: service.name,
            rpc: rpc.name,
            requestType: rpc.requestType,
            responseType: rpc.responseType,
            requestStream: rpc.requestStream,
            responseStream: rpc.responseStream,
          },
          protobufPackage: document.packageName,
        },
      });
    }
  }

  const firstService = document.services[0]?.name;
  return {
    version: 1,
    api: {
      name: document.packageName ?? (firstService ? `${firstService} API` : 'Protobuf API'),
      version: '0.0.0',
      source: { kind: sourceKind, origin: ctx.origin, ingestedAt: 0 },
    },
    servers: [],
    auth: [],
    resources,
    endpoints,
    relationships: [],
    examples: [],
    meta: {
      protobufPackage: document.packageName,
      messageCount: document.messages.length,
      serviceCount: document.services.length,
    },
  };
}

function parseMessages(source: string): ProtoMessage[] {
  return parseBlocks(source, 'message').map((block) => ({
    name: block.name,
    fields: parseFields(removeNestedBlocks(block.body)),
  }));
}

function parseServices(source: string): ProtoService[] {
  return parseBlocks(source, 'service').map((block) => ({
    name: block.name,
    rpcs: parseRpcs(block.body),
  }));
}

function parseFields(body: string): ProtoField[] {
  const fields: ProtoField[] = [];
  const fieldPattern =
    /\b(?:(optional|repeated|required)\s+)?(map\s*<\s*[^>]+>|[A-Za-z_][\w.]*)\s+([A-Za-z_][\w]*)\s*=\s*(\d+)(?:\s*\[[^\]]*\])?\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = fieldPattern.exec(body)) !== null) {
    const label = match[1] as ProtoField['label'] | undefined;
    const type = match[2];
    const name = match[3];
    const tag = Number(match[4]);
    if (!type || !name || !Number.isFinite(tag)) continue;
    fields.push({ name, type: type.replace(/\s+/g, ' '), label, tag });
  }
  return fields;
}

function parseRpcs(body: string): ProtoRpc[] {
  const rpcs: ProtoRpc[] = [];
  const rpcPattern =
    /\brpc\s+([A-Za-z_][\w]*)\s*\(\s*(stream\s+)?([.\w]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([.\w]+)\s*\)\s*(?:;|\{[\s\S]*?\})/g;
  let match: RegExpExecArray | null;
  while ((match = rpcPattern.exec(body)) !== null) {
    const name = match[1];
    const requestType = match[3];
    const responseType = match[5];
    if (!name || !requestType || !responseType) continue;
    rpcs.push({
      name,
      requestType: cleanTypeName(requestType),
      responseType: cleanTypeName(responseType),
      requestStream: Boolean(match[2]),
      responseStream: Boolean(match[4]),
    });
  }
  return rpcs;
}

function parseBlocks(
  source: string,
  keyword: 'message' | 'service',
): Array<{ name: string; body: string }> {
  const blocks: Array<{ name: string; body: string }> = [];
  const pattern = new RegExp(`\\b${keyword}\\s+([A-Za-z_][\\w]*)\\s*\\{`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1];
    const openBrace = pattern.lastIndex - 1;
    const closeBrace = findMatchingBrace(source, openBrace);
    if (!name || closeBrace === -1) continue;
    blocks.push({ name, body: source.slice(openBrace + 1, closeBrace) });
    pattern.lastIndex = closeBrace + 1;
  }
  return blocks;
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;
  for (let i = openBrace; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function removeNestedBlocks(body: string): string {
  return body.replace(/\b(message|enum|service|oneof)\s+[A-Za-z_][\w]*\s*\{[\s\S]*?\}/g, '');
}

function messageToResource(message: ProtoMessage): ResourceDef {
  const properties: Record<string, JsonType> = {};
  const required: string[] = [];
  for (const field of message.fields) {
    properties[field.name] = protoTypeToJsonType(field);
    if (field.label === 'required') required.push(field.name);
  }
  return {
    id: asResourceId(normalizeTypeName(message.name)),
    name: message.name,
    primaryKey: message.fields.find((field) => field.name.toLowerCase() === 'id')?.name ?? 'id',
    schema: { kind: 'object', properties, required },
  };
}

function protoTypeToJsonType(field: ProtoField): JsonType {
  const type = field.type.trim();
  const base = scalarToJsonType(type);
  const normalized = field.label === 'repeated' ? { kind: 'array', items: base } : base;
  return normalized as JsonType;
}

function scalarToJsonType(type: string): JsonType {
  if (/^map\s*</.test(type)) return { kind: 'object', properties: {}, required: [] };
  switch (cleanTypeName(type)) {
    case 'string':
    case 'bytes':
      return { kind: 'string' };
    case 'bool':
      return { kind: 'boolean' };
    case 'double':
    case 'float':
      return { kind: 'number' };
    case 'int32':
    case 'int64':
    case 'uint32':
    case 'uint64':
    case 'sint32':
    case 'sint64':
    case 'fixed32':
    case 'fixed64':
    case 'sfixed32':
    case 'sfixed64':
      return { kind: 'integer' };
    default:
      return { kind: 'ref', ref: cleanTypeName(type) };
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function cleanTypeName(type: string): string {
  return type.replace(/^\./, '');
}

function normalizeTypeName(type: string): string {
  return cleanTypeName(type)
    .split('.')
    .at(-1)!
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .toLowerCase();
}

function asResourceId(name: string): ResourceId {
  return name as ResourceId;
}
