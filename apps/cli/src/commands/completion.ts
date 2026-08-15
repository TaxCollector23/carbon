import { defineCommand } from 'citty';
import { ui } from '../ui.js';

/**
 * Emit shell completion scripts. citty doesn't ship a completion generator, so
 * we hand-write reasonably capable static scripts for the three shells our
 * users actually run. Each script completes the top-level subcommand list and
 * the `snapshot` subcommand set; flags and file paths fall through to the
 * shell's default completer.
 *
 * Usage:
 *   carbon completion bash  >> ~/.bashrc
 *   carbon completion zsh   >  ~/.zsh/completions/_carbon
 *   carbon completion fish  >  ~/.config/fish/completions/carbon.fish
 */

const TOP_COMMANDS = [
  'capabilities',
  'init',
  'login',
  'logout',
  'whoami',
  'record',
  'ingest',
  'emulate',
  'inspect',
  'snapshot',
  'try',
  'replay',
  'serve',
  'doctor',
  'diff',
  'generate-tests',
  'usage',
  'watch',
  'activity',
  'quality',
  'export',
  'explain',
  'completion',
  'audit-secrets',
];
const SNAPSHOT_SUB = ['save', 'load', 'list', 'delete', 'push', 'pull'];

export const completionCommand = defineCommand({
  meta: {
    name: 'completion',
    description: 'Print a shell completion script (bash, zsh, or fish).',
  },
  args: {
    shell: {
      type: 'positional',
      description: 'Target shell: bash, zsh, or fish',
      required: true,
    },
  },
  run({ args }) {
    const shell = String(args.shell).toLowerCase();
    switch (shell) {
      case 'bash':
        process.stdout.write(bashScript());
        return;
      case 'zsh':
        process.stdout.write(zshScript());
        return;
      case 'fish':
        process.stdout.write(fishScript());
        return;
      default:
        ui.error(`Unknown shell: ${shell}. Use one of: bash, zsh, fish.`);
        process.exitCode = 1;
    }
  },
});

function bashScript(): string {
  const top = TOP_COMMANDS.join(' ');
  const snap = SNAPSHOT_SUB.join(' ');
  return `# carbon bash completion
_carbon_complete() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${top}" -- "$cur") )
    return
  fi
  case "\${COMP_WORDS[1]}" in
    snapshot)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=( $(compgen -W "${snap}" -- "$cur") )
      fi
      ;;
  esac
}
complete -F _carbon_complete carbon
complete -F _carbon_complete carbon-dev
`;
}

function zshScript(): string {
  const top = TOP_COMMANDS.join(' ');
  const snap = SNAPSHOT_SUB.join(' ');
  return `#compdef carbon carbon-dev
# carbon zsh completion
_carbon() {
  local -a cmds snap
  cmds=(${top})
  snap=(${snap})
  if (( CURRENT == 2 )); then
    compadd -a cmds
    return
  fi
  case "\${words[2]}" in
    snapshot)
      if (( CURRENT == 3 )); then
        compadd -a snap
      fi
      ;;
  esac
}
_carbon "$@"
`;
}

function fishScript(): string {
  const lines: string[] = ['# carbon fish completion'];
  for (const c of TOP_COMMANDS) {
    lines.push(`complete -c carbon -n "__fish_use_subcommand" -a "${c}"`);
    lines.push(`complete -c carbon-dev -n "__fish_use_subcommand" -a "${c}"`);
  }
  for (const s of SNAPSHOT_SUB) {
    lines.push(`complete -c carbon -n "__fish_seen_subcommand_from snapshot" -a "${s}"`);
    lines.push(`complete -c carbon-dev -n "__fish_seen_subcommand_from snapshot" -a "${s}"`);
  }
  return `${lines.join('\n')}\n`;
}
