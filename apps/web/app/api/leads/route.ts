import { NextResponse, type NextRequest } from 'next/server';

interface LeadPayload {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly seats: number;
  readonly useCase: string;
  readonly source?: string;
}

function isLeadPayload(value: unknown): value is LeadPayload {
  if (!value || typeof value !== 'object') return false;
  const lead = value as Record<string, unknown>;
  return (
    typeof lead.name === 'string' &&
    lead.name.trim().length > 0 &&
    typeof lead.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email.trim()) &&
    typeof lead.company === 'string' &&
    lead.company.trim().length > 0 &&
    typeof lead.useCase === 'string' &&
    lead.useCase.trim().length > 0 &&
    typeof lead.seats === 'number' &&
    Number.isFinite(lead.seats) &&
    lead.seats >= 1
  );
}

function cleanLead(lead: LeadPayload): LeadPayload {
  return {
    name: lead.name.trim().slice(0, 160),
    email: lead.email.trim().toLowerCase().slice(0, 320),
    company: lead.company.trim().slice(0, 200),
    seats: Math.min(Math.floor(lead.seats), 100_000),
    useCase: lead.useCase.trim().slice(0, 2_000),
    source: lead.source?.trim().slice(0, 120),
  };
}

export async function POST(req: NextRequest) {
  const parsed = (await req.json().catch(() => null)) as unknown;
  if (!isLeadPayload(parsed)) {
    return NextResponse.json(
      { error: { code: 'CARBON_INVALID_INPUT', message: 'Complete every field to send.' } },
      { status: 400 },
    );
  }

  const lead = cleanLead(parsed);
  const webhookUrl = process.env.CARBON_LEADS_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...lead,
        submittedAt: new Date().toISOString(),
        userAgent: req.headers.get('user-agent'),
      }),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: { code: 'CARBON_LEAD_FORWARD_FAILED', message: 'Lead capture is unavailable.' } },
        { status: 502 },
      );
    }
  } else {
    console.info('carbon.enterprise_lead.accepted', {
      emailDomain: lead.email.split('@')[1],
      company: lead.company,
      seats: lead.seats,
      source: lead.source,
    });
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
