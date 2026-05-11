export interface TwilioClient {
  sendMessage(to: string, body: string): Promise<string>;
}
