import twilio from 'twilio';
import { TwilioClient } from './twilio.interface.ts';
import { config } from '../../config.ts';

export class RealTwilioClient implements TwilioClient {
  private client: ReturnType<typeof twilio>;

  constructor() {
    if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_FROM_NUMBER) {
      throw new Error('Missing Twilio credentials');
    }
    this.client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  }

  async sendMessage(to: string, body: string): Promise<{ sid: string }> {
    const msg = await this.client.messages.create({
      to,
      from: config.TWILIO_FROM_NUMBER!,
      body,
    });
    return { sid: msg.sid };
  }
}
