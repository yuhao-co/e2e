import { spawn } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

type RunResult = {
  exitCode: number;
  durationMs: number;
  outputLines: string[];
};

function parseArgs(argv: string[]) {
  let label = 'Command run';
  const commandIndex = argv.indexOf('--');
  const optionArgs = commandIndex >= 0 ? argv.slice(0, commandIndex) : argv;
  const commandArgs = commandIndex >= 0 ? argv.slice(commandIndex + 1) : [];

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (arg === '--label') {
      label = optionArgs[index + 1] ?? label;
      index += 1;
    }
  }

  if (commandArgs.length === 0) {
    throw new Error('Missing command. Use: npm run notify:run -- --label "..." -- <command>');
  }

  return {
    label,
    command: commandArgs.join(' '),
  };
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function tailLines(lines: string[], count: number) {
  return lines.slice(-count);
}

async function runCommand(command: string): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const outputBuffer: string[] = [];
    let trailingChunk = '';

    const child = spawn(command, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const pushChunk = (chunk: string) => {
      process.stdout.write(chunk);
      const combined = trailingChunk + chunk;
      const parts = combined.split(/\r?\n/);
      trailingChunk = parts.pop() ?? '';
      outputBuffer.push(...parts);
    };

    const pushErrorChunk = (chunk: string) => {
      process.stderr.write(chunk);
      const combined = trailingChunk + chunk;
      const parts = combined.split(/\r?\n/);
      trailingChunk = parts.pop() ?? '';
      outputBuffer.push(...parts);
    };

    child.stdout.on('data', (data: Buffer | string) => {
      pushChunk(String(data));
    });

    child.stderr.on('data', (data: Buffer | string) => {
      pushErrorChunk(String(data));
    });

    child.on('error', (error: Error) => {
      reject(error);
    });

    child.on('close', (code: number | null) => {
      if (trailingChunk) {
        outputBuffer.push(trailingChunk);
      }

      resolve({
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        outputLines: outputBuffer,
      });
    });
  });
}

async function postToLark(webhookUrl: string, text: string) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Lark webhook request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { code?: number; msg?: string };
  if (payload.code && payload.code !== 0) {
    throw new Error(`Lark webhook rejected message: ${payload.msg ?? payload.code}`);
  }
}

async function main() {
  loadDotenv();

  const webhookUrl = process.env.LARK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('Missing LARK_WEBHOOK_URL environment variable.');
  }

  const { label, command } = parseArgs(process.argv.slice(2));
  const hostname = process.env.HOSTNAME ?? 'local';

  let exitCode = 1;
  let durationMs = 0;
  let outputLines: string[] = [];
  let runError: unknown;

  try {
    const result = await runCommand(command);
    exitCode = result.exitCode;
    durationMs = result.durationMs;
    outputLines = result.outputLines;
  } catch (error) {
    runError = error;
    outputLines = [error instanceof Error ? error.message : String(error)];
  }

  const status = exitCode === 0 && !runError ? 'SUCCESS' : 'FAILED';
  const summaryLines = tailLines(outputLines, 12)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');

  const message = [
    `[${status}] ${label}`,
    `Command: ${command}`,
    `Exit code: ${exitCode}`,
    `Duration: ${formatDuration(durationMs)}`,
    `Host: ${hostname}`,
    summaryLines ? `Last output:\n${summaryLines}` : 'Last output: <empty>',
  ].join('\n');

  try {
    await postToLark(webhookUrl, message);
  } catch (error) {
    const notifyError = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send Lark notification: ${notifyError}`);
    if (!runError && exitCode === 0) {
      process.exitCode = 1;
      return;
    }
  }

  if (runError) {
    console.error(runError instanceof Error ? runError.message : String(runError));
  }

  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});