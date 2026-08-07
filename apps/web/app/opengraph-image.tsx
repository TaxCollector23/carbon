import { ImageResponse } from 'next/og';

export const alt = 'Carbon — local API replicas that actually behave';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#ffffff',
          color: '#111',
          display: 'flex',
          flexDirection: 'column',
          padding: 72,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              background: '#111',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            C
          </div>
          <span style={{ fontSize: 24, fontWeight: 600 }}>Carbon</span>
        </div>
        <div
          style={{
            marginTop: 'auto',
            fontSize: 88,
            fontWeight: 500,
            letterSpacing: -2,
            lineHeight: 1.05,
          }}
        >
          Local API replicas
          <br />
          that actually behave.
        </div>
        <div style={{ marginTop: 24, fontSize: 24, color: '#555' }}>
          OpenAPI · HAR · Postman · GraphQL → a stateful runtime on localhost.
        </div>
      </div>
    ),
    { ...size },
  );
}
