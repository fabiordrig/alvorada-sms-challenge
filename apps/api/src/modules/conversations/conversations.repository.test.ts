import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db/client.ts', () => ({
  db: {
    query: { conversations: { findMany: vi.fn() } },
    select: vi.fn(),
  },
}));

import {
  findConversations,
  findMessagesByConversation,
  findConversationById,
} from './conversations.repository';
import { db } from '../../db/client';

const mockDb = db as {
  query: { conversations: { findMany: ReturnType<typeof vi.fn> } };
  select: ReturnType<typeof vi.fn>;
};

const NOW = new Date('2024-01-15T10:00:00.000Z');
const NOW_ISO = NOW.toISOString();

function makeDbConversation(overrides = {}) {
  return {
    id: 'conv-1',
    phoneNumber: '+5511999000001',
    createdAt: NOW,
    updatedAt: NOW,
    messages: [],
    ...overrides,
  };
}

function makeDbMessage(overrides = {}) {
  return {
    id: 'msg-1',
    conversationId: 'conv-1',
    twilioSid: 'SM001',
    direction: 'inbound' as const,
    body: 'Hello',
    status: 'received' as const,
    error: null,
    attempts: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// Makes a chain where .where() is thenable (for findConversationById) and has .orderBy() (for findMessagesByConversation)
function buildSelectChain(result: unknown[]) {
  const whereResult = Object.assign(Promise.resolve(result), {
    orderBy: vi.fn().mockResolvedValue(result),
  });
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findConversations', () => {
  it('maps DB rows to ConversationWithLastMessage[]', async () => {
    const dbMsg = makeDbMessage();
    mockDb.query.conversations.findMany.mockResolvedValue([
      makeDbConversation({ messages: [dbMsg] }),
    ]);

    const result = await findConversations();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'conv-1',
      phoneNumber: '+5511999000001',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      lastMessage: {
        id: 'msg-1',
        conversationId: 'conv-1',
        twilioSid: 'SM001',
        direction: 'inbound',
        body: 'Hello',
        status: 'received',
        error: null,
        attempts: 0,
        createdAt: NOW_ISO,
        updatedAt: NOW_ISO,
      },
    });
  });

  it('lastMessage is null when conversation has no messages', async () => {
    mockDb.query.conversations.findMany.mockResolvedValue([
      makeDbConversation({ messages: [] }),
    ]);

    const result = await findConversations();

    expect(result[0].lastMessage).toBeNull();
  });

  it('returns empty array when no conversations', async () => {
    mockDb.query.conversations.findMany.mockResolvedValue([]);

    const result = await findConversations();

    expect(result).toEqual([]);
  });
});

describe('findMessagesByConversation', () => {
  it('maps DB rows to Message[]', async () => {
    const dbMsg = makeDbMessage();
    mockDb.select.mockReturnValue(buildSelectChain([dbMsg]));

    const result = await findMessagesByConversation('conv-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'msg-1',
      conversationId: 'conv-1',
      twilioSid: 'SM001',
      direction: 'inbound',
      body: 'Hello',
      status: 'received',
      error: null,
      attempts: 0,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
  });

  it('twilioSid and error are null when undefined in DB', async () => {
    const dbMsg = makeDbMessage({ twilioSid: undefined, error: undefined });
    mockDb.select.mockReturnValue(buildSelectChain([dbMsg]));

    const result = await findMessagesByConversation('conv-1');

    expect(result[0].twilioSid).toBeNull();
    expect(result[0].error).toBeNull();
  });

  it('returns empty array when no messages', async () => {
    mockDb.select.mockReturnValue(buildSelectChain([]));

    const result = await findMessagesByConversation('conv-1');

    expect(result).toEqual([]);
  });
});

describe('findConversationById', () => {
  it('returns Conversation when found', async () => {
    const dbConv = makeDbConversation();
    mockDb.select.mockReturnValue(buildSelectChain([dbConv]));

    const result = await findConversationById('conv-1');

    expect(result).toEqual({
      id: 'conv-1',
      phoneNumber: '+5511999000001',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
  });

  it('returns null when not found', async () => {
    mockDb.select.mockReturnValue(buildSelectChain([]));

    const result = await findConversationById('nonexistent');

    expect(result).toBeNull();
  });
});
