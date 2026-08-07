import { defineCommand } from 'citty';
import { ui } from '../ui.js';

export const loginCommand = defineCommand({
  meta: { name: 'login', description: 'Use API keys for account-backed workflows.' },
  async run() {
    ui.warn('Browser login is not available in this build. Use API keys for now.');
  },
});
