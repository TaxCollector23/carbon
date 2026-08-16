export function normalizeRedisUrl(raw: string): string {
  const trimmed = stripOuterQuotes(raw.trim());
  const direct = parseRedisUrl(trimmed);
  if (direct) return direct;

  const tokens = tokenizeCommand(trimmed);
  const urlFromFlag = redisUrlFromCliTokens(tokens);
  if (urlFromFlag) return urlFromFlag;

  return trimmed;
}

export function isRedisConnectionUrl(raw: string): boolean {
  return Boolean(parseRedisUrl(raw.trim()));
}

function redisUrlFromCliTokens(tokens: readonly string[]): string | null {
  const tls = tokens.includes('--tls');
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if ((token === '-u' || token === '--url') && tokens[i + 1]) {
      const parsed = parseRedisUrl(tokens[i + 1]!);
      if (parsed) return tls ? forceTlsScheme(parsed) : parsed;
    }
    if (token.startsWith('--url=')) {
      const parsed = parseRedisUrl(token.slice('--url='.length));
      if (parsed) return tls ? forceTlsScheme(parsed) : parsed;
    }
  }
  return null;
}

function parseRedisUrl(raw: string): string | null {
  const value = stripOuterQuotes(raw.trim());
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function forceTlsScheme(raw: string): string {
  const url = new URL(raw);
  if (url.protocol === 'redis:') url.protocol = 'rediss:';
  return url.toString();
}

function stripOuterQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}
