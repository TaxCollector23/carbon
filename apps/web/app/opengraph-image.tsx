import { ImageResponse } from 'next/og';

export const alt = 'Carbon - stateful API replicas for development and CI';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OG() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#f8fafc',
        color: '#1f2937',
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
            background: '#243041',
            color: '#f8fafc',
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
          display: 'flex',
          flexDirection: 'column',
          fontSize: 88,
          fontWeight: 500,
          letterSpacing: 0,
          lineHeight: 1.05,
        }}
      >
        <span>Stateful API replicas</span>
        <span>for development and CI.</span>
      </div>
      <div style={{ marginTop: 24, fontSize: 24, color: '#64748b' }}>
        OpenAPI / AsyncAPI / gRPC / HAR / GraphQL to a stateful runtime.
      </div>
    </div>,
    { ...size },
  );
}
