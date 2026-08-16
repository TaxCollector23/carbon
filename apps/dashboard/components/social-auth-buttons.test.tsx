import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SocialAuthButtons } from './social-auth-buttons';

vi.mock('@/lib/auth-client', () => ({
  signIn: { social: vi.fn() },
}));

describe('SocialAuthButtons', () => {
  it('renders Google sign-in without offering GitHub OAuth', () => {
    const html = renderToStaticMarkup(<SocialAuthButtons next="/" onError={() => {}} />);

    expect(html).toContain('Continue with Google');
    expect(html).not.toContain('Continue with GitHub');
    expect(html).not.toContain('Opening GitHub');
  });
});
