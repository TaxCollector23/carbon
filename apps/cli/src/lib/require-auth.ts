import { ui } from '../ui.js';
import { isJson } from './printer.js';
import { loadCredentials, type Credentials } from './credentials.js';

/**
 * Guard for every command that talks to the Carbon cloud control plane.
 *
 * Sign-in is now the first thing a new user does — every non-local command
 * calls this before touching the network. If `~/.carbon/credentials` is
 * missing the user gets a one-line "run `carbon login` first" and the
 * process exits with code 7 (auth-required) so scripts can tell it apart
 * from a network or assertion failure.
 *
 * Local-only commands (init, doctor, completion, emulate against a local
 * spec) never call this. `login` and `logout` obviously never call it.
 */
export const EXIT_AUTH_REQUIRED = 7;

export async function requireAuth(): Promise<Credentials> {
  const creds = await loadCredentials();
  if (creds) return creds;

  if (isJson()) {
    ui.event(
      'auth.required',
      {
        message:
          "You're not signed in. Run `carbon login` to open the Carbon dashboard, create an account, and link this CLI.",
      },
      'error',
    );
  } else {
    ui.error("You're not signed in.");
    process.stdout.write(
      "\n  Run `carbon login` to open the Carbon dashboard, create an account,\n" +
        '  and link this CLI. It takes about 30 seconds.\n\n',
    );
  }
  process.exit(EXIT_AUTH_REQUIRED);
}
