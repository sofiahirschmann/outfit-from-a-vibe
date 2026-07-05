// Build-time LLM transport for harvest tagging.
//
// Prefers the Anthropic SDK (claude-opus-4-8, structured outputs) when
// ANTHROPIC_API_KEY is set. Falls back to a local Claude Code CLI in headless
// mode (`claude -p`) so the seed catalog can be rebuilt on a dev machine with
// no API key. Runtime code (lib/) always uses the SDK — this fallback is
// harvest-only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);

// The VS Code extension auto-updates mid-run and can briefly (or permanently)
// invalidate a captured binary path — discover the newest installed version
// fresh instead of trusting a stale env var alone.
function discoverVSCodeCli() {
  try {
    const extDir = path.join(os.homedir(), '.vscode', 'extensions');
    return fs
      .readdirSync(extDir)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse()
      .map((d) => path.join(extDir, d, 'resources', 'native-binary', 'claude'))
      .filter((p) => fs.existsSync(p));
  } catch {
    return [];
  }
}

const CLI_CANDIDATES = [
  process.env.CLAUDE_CLI,
  process.env.CLAUDE_CODE_EXECPATH,
  ...discoverVSCodeCli(),
  'claude',
].filter(Boolean);

export async function llmJSON({ system, prompt, schema, maxTokens = 8000 }) {
  if (process.env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const res = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.find((b) => b.type === 'text')?.text ?? '';
    return JSON.parse(text);
  }
  return cliJSON({ system, prompt, schema });
}

async function cliJSON({ system, prompt, schema }) {
  const fullPrompt = [
    system,
    '',
    prompt,
    '',
    'Respond with ONLY the JSON value (no markdown fences, no commentary) matching this JSON schema:',
    JSON.stringify(schema),
  ].join('\n');

  let lastErr;
  for (const cli of CLI_CANDIDATES) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const pending = execFileP(cli, ['-p', fullPrompt, '--output-format', 'text'], {
          maxBuffer: 32 * 1024 * 1024,
          timeout: 600_000,
          env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: undefined },
        });
        pending.child.stdin?.end(); // never leave the CLI waiting on stdin
        const { stdout } = await pending;
        return JSON.parse(extractJSON(stdout));
      } catch (err) {
        // Keep the most informative error: a bare-`claude` ENOENT at the end
        // of the candidate list must not mask a real failure from the actual
        // binary that ran.
        if (!lastErr || err.code !== 'ENOENT') lastErr = err;
        if (err.code === 'ENOENT') break; // try next candidate binary
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); // transient blip — retry
      }
    }
  }
  throw new Error(
    `No LLM available: set ANTHROPIC_API_KEY or install the claude CLI (${lastErr?.message ?? 'not found'})`,
  );
}

function extractJSON(text) {
  const starts = ['{', '['].map((c) => text.indexOf(c)).filter((i) => i !== -1);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start === -1 || end <= start) {
    throw new Error(`No JSON found in LLM output: ${text.slice(0, 200)}`);
  }
  return text.slice(start, end + 1);
}
