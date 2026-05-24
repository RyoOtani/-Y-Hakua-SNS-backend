const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const REQUEST_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 15000);

const toPositiveInteger = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const sanitizeMessages = (messages) => {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => ({
      role: message.role === 'system' ? 'system' : 'user',
      content: String(message.content || '').slice(0, 12000),
    }))
    .filter((message) => message.content.trim().length > 0);
};

const callGroqChatCompletion = async ({
  messages,
  temperature = 0.2,
  maxTokens = 600,
} = {}) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    const err = new Error('GROQ_API_KEY is not configured');
    err.code = 'GROQ_API_KEY_MISSING';
    throw err;
  }

  const sanitizedMessages = sanitizeMessages(messages);
  if (sanitizedMessages.length === 0) {
    const err = new Error('messages are required');
    err.code = 'GROQ_MESSAGES_INVALID';
    throw err;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), toPositiveInteger(REQUEST_TIMEOUT_MS, 15000));

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: DEFAULT_GROQ_MODEL,
        messages: sanitizedMessages,
        temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2,
        max_tokens: toPositiveInteger(maxTokens, 600),
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const err = new Error(payload?.error?.message || `Groq API request failed: ${response.status}`);
      err.code = 'GROQ_API_ERROR';
      err.status = response.status;
      err.details = payload;
      throw err;
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      const err = new Error('Groq API returned empty content');
      err.code = 'GROQ_EMPTY_CONTENT';
      throw err;
    }

    return {
      id: payload?.id || null,
      model: payload?.model || DEFAULT_GROQ_MODEL,
      content: content.trim(),
      usage: payload?.usage || null,
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Groq API request timed out');
      timeoutError.code = 'GROQ_TIMEOUT';
      throw timeoutError;
    }

    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};

module.exports = {
  callGroqChatCompletion,
};
