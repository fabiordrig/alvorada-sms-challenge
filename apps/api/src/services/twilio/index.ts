import type { TwilioClient } from './twilio.interface';
import { MockTwilioClient } from './twilio.mock';
import { RealTwilioClient } from './twilio.real';
import { config } from '../../config';

export type { TwilioClient };

let _client: TwilioClient | null = null;

export function getTwilioClient(): TwilioClient {
  if (!_client) {
    _client = config.TWILIO_USE_MOCK ? new MockTwilioClient() : new RealTwilioClient();
  }
  return _client;
}
