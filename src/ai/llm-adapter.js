import chalk from 'chalk';

// Minimal LLM adapter exposing a `query` function compatible with
// the usage pattern in claude-executor.js. Defaults to Anthropic
// Claude Agent SDK; supports an OpenAI-compatible pathway when
// SHANNON_LLM_PROVIDER=openai is set.

const provider = (process.env.SHANNON_LLM_PROVIDER || (process.env.CLAUDE_CODE_USE_BEDROCK ? 'bedrock' : 'anthropic')).toLowerCase();

export async function* query({ prompt, options = {} }) {
  if (provider === 'openai') {
    const baseUrl = process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const apiKey = process.env.OPENAI_API_KEY || '';
    const model = process.env.SHANNON_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const enableStream = (process.env.SHANNON_OPENAI_STREAM || 'true').toLowerCase() !== 'false';
    const logIntervalMs = Number(process.env.SHANNON_OPENAI_STREAM_LOG_INTERVAL_MS || 1000);

    try {
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      if (enableStream) {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            stream: true,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`OpenAI-compatible request failed (${res.status}): ${text}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullContent = '';
        let lastLog = Date.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let parts = buffer.split('\n\n');
          buffer = parts.pop();

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            const dataStr = line.replace(/^data:\s*/, '');
            if (dataStr === '[DONE]') {
              buffer = '';
              break;
            }
            try {
              const json = JSON.parse(dataStr);
              const delta = json?.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent += delta;
                const now = Date.now();
                if (now - lastLog >= logIntervalMs && !global.SHANNON_DISABLE_LOADER) {
                  console.log(chalk.gray(`    … ${fullContent.slice(-120)}`));
                  lastLog = now;
                }
              }
            } catch {
              // Ignore parse errors on keep-alive/non-JSON events
            }
          }
        }

        // Yield a single assistant turn to match downstream expectations
        yield { type: 'assistant', message: { content: fullContent } };
        return;
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            stream: false,
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`OpenAI-compatible request failed (${res.status}): ${text}`);
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || '';
        yield { type: 'assistant', message: { content } };
        return;
      }
    } catch (err) {
      // Surface error as a single assistant message to avoid breaking loops
      const msg = `OpenAI adapter error: ${err.message}`;
      console.log(chalk.red(`    ❌ ${msg}`));
      yield { type: 'assistant', message: { content: msg } };
      return;
    }
  }

  // Anthropic/Bedrock passthrough via Claude Agent SDK
  if (provider === 'bedrock') {
    process.env.CLAUDE_CODE_USE_BEDROCK = process.env.CLAUDE_CODE_USE_BEDROCK || '1';
  }
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const iterator = sdk.query({ prompt, options });
  for await (const message of iterator) {
    yield message;
  }
}
