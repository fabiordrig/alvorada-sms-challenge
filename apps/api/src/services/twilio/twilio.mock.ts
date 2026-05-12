import { TwilioClient } from './twilio.interface';
import { config } from '../../config';
import { logger } from '../../lib/logger';

export class MockTwilioClient implements TwilioClient {
  async sendMessage(to: string, body: string): Promise<{ sid: string }> {
    const delay =
      Math.floor(Math.random() * (config.TWILIO_MOCK_DELAY_MAX - config.TWILIO_MOCK_DELAY_MIN)) +
      config.TWILIO_MOCK_DELAY_MIN;

    await new Promise((res) => setTimeout(res, delay));

    if (Math.random() < config.TWILIO_MOCK_FAIL_RATE) {
      throw new Error('Mock Twilio failure (TWILIO_MOCK_FAIL_RATE)');
    }

    const sid = `SM_mock_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    logger.info({ to, body: body.slice(0, 50), sid, delayMs: delay }, 'mock twilio send');
    return { sid };
  }
}
