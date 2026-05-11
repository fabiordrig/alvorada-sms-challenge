import { EventEmitter } from 'events';
import { SseEvent } from '@sms/shared';

class SseBus extends EventEmitter {
  emit(event: SseEvent['type'], data: SseEvent): boolean {
    return super.emit(event, data);
  }

  on(event: SseEvent['type'], listener: (data: SseEvent) => void): this {
    return super.on(event, listener);
  }

  off(event: SseEvent['type'], listener: (data: SseEvent) => void): this {
    return super.off(event, listener);
  }
}

export const sseBus = new SseBus();
sseBus.setMaxListeners(1000);
