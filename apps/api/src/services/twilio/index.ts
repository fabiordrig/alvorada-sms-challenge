import type { TwilioClient } from './twilio.interface.ts';
import { MockTwilioClient } from './twilio.mock.ts';
import { RealTwilioClient } from './twilio.real.ts';
import { config } from '../../config.ts';

export type { TwilioClient };

let _client: TwilioClient | null = null;

export function getTwilioClient(): TwilioClient {
  if (!_client) {
    _client = config.TWILIO_USE_MOCK ? new MockTwilioClient() : new RealTwilioClient();
  }
  return _client;
}
