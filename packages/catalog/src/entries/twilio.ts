import type { CatalogEntry } from '../types.js';

export const twilio: CatalogEntry = {
  slug: 'twilio',
  name: 'Twilio',
  tagline: 'Messaging API (2010)',
  category: 'communication',
  logo: 'T',
  specUrl:
    'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json',
  specFormat: 'openapi',
  homepage: 'https://www.twilio.com/docs/usage/api',
  quickstart: 'npx carbon-dev emulate --catalog twilio',
  seedResources: ['Messages', 'Calls', 'IncomingPhoneNumbers'],
  description:
    'Send fake SMS, MMS, and voice calls through a local Twilio replica. Carbon persists the message log and phone-number pool between requests, so your notification pipeline can be tested end-to-end without spending on real SMS.',
};
