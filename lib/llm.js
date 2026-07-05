// Runtime LLM transport. Production path: @anthropic-ai/sdk with
// ANTHROPIC_API_KEY, model claude-opus-4-8, structured outputs via
// output_config.format (json_schema). No temperature/top_p — removed on 4.8.
//
// Dev-only fallback: if no key is set and we're not in production, shell out
// to a local Claude Code CLI (headless `claude -p`) so the demo runs cold on a
// machine that's logged into Claude Code. Slower, clearly not for deploys.
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);
const MODEL = 'claude-opus-4-8';

let client = null;

// Dev-only: the VS Code extension auto-updates and can invalidate a captured
// binary path mid-session — resolve the newest installed version at call time.
function resolveCli() {
  for (const p of [process.env.CLAUDE_CLI, process.env.CLAUDE_CODE_EXECPATH]) {
    if (p && fs.existsSync(p)) return p;
  }
  try {
    const extDir = path.join(os.homedir(), '.vscode', 'extensions');
    const found = fs
      .readdirSync(extDir)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse()
      .map((d) => path.join(extDir, d, 'resources', 'native-binary', 'claude'))
      .find((p) => fs.existsSync(p));
    if (found) return found;
  } catch {
    /* fall through */
  }
  return null;
}

export async function llmJSON({ system, prompt, schema, maxTokens = 4000 }) {
  if (process.env.ANTHROPIC_API_KEY) {
    client ??= new Anthropic();
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.find((b) => b.type === 'text')?.text ?? '';
    return JSON.parse(text);
  }

  const cli = process.env.NODE_ENV !== 'production' ? resolveCli() : null;
  if (cli) {
    return cliJSON({ cli, system, prompt, schema });
  }

  throw new Error('ANTHROPIC_API_KEY is not set (see .env.example)');
}

async function cliJSON({ cli, system, prompt, schema }) {
  const fullPrompt = [
    system,
    '',
    prompt,
    '',
    'Respond with ONLY the JSON value (no markdown fences, no commentary) matching this JSON schema:',
    JSON.stringify(schema),
  ].join('\n');

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pending = execFileP(cli, ['-p', fullPrompt, '--output-format', 'text'], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
      });
      pending.child.stdin?.end(); // never leave the CLI waiting on stdin
      const { stdout } = await pending;
      const starts = ['{', '['].map((c) => stdout.indexOf(c)).filter((i) => i !== -1);
      const start = starts.length ? Math.min(...starts) : -1;
      const end = Math.max(stdout.lastIndexOf('}'), stdout.lastIndexOf(']'));
      if (start === -1 || end <= start) {
        throw new Error(`No JSON in CLI output: ${stdout.slice(0, 120)}`);
      }
      return JSON.parse(stdout.slice(start, end + 1));
    } catch (err) {
      lastErr = err; // transient network / API blips — brief pause, run it back
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  throw lastErr;
}
