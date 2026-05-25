import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

type RunResult = {
  exitCode: number;
  durationMs: number;
  outputLines: string[];
};

type FailureDetail = {
  specPath: string;
  errorSnippet: string;
  commits: string[];
  prdLinks: string[];
};

type RunInsights = {
  target: string;
  passed: string;
  failed: string;
  changedFiles: string;
  candidates: string;
  highlight: string;
};

type LarkCardPayload = {
  msg_type: 'interactive';
  card: {
    config: {
      wide_screen_mode: boolean;
      enable_forward: boolean;
    };
    header: {
      template: string;
      title: {
        tag: 'plain_text';
        content: string;
      };
    };
    elements: Array<Record<string, unknown>>;
  };
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
    commandArgs,
  };
}

function formatCommandForDisplay(commandArgs: string[]) {
  return commandArgs
    .map((arg) => {
      if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) {
        return arg;
      }

      return `'${arg.replaceAll("'", `'\\''`)}'`;
    })
    .join(' ');
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function extractPlaywrightFailures(lines: string[]): Array<{ specPath: string; errorSnippet: string }> {
  const failures: Array<{ specPath: string; errorSnippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Match Playwright list reporter failure lines (both ✘ during run and N) in summary)
    const specMatch = line.match(/(?:[✘✗×]\s+\d+|\s+\d+\)).*?(?:›\s+)?(tests\/\S+\.spec\.ts)/);
    if (specMatch?.[1]) {
      const specPath = specMatch[1].replace(/:\d+:\d+$/, '');
      // Collect error lines (skip stack frames)
      const errorLines: string[] = [];
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const next = (lines[j] ?? '').trim();
        if (!next) continue;
        if (/^[✘✓✗×]\s+\d+|^\s*\d+\)\s/.test(next)) break;
        if (/^at\s+\S/.test(next) || /^\s+at\s+/.test(lines[j] ?? '')) break;
        errorLines.push(next);
        if (errorLines.length >= 3) break;
      }
      // Deduplicate by specPath (keep first occurrence)
      if (!failures.some((f) => f.specPath === specPath)) {
        failures.push({ specPath, errorSnippet: errorLines.join(' | ').trim() });
      }
    }
  }
  return failures;
}

function readSpecMetadata(specPath: string): { commits: string[]; prdLinks: string[] } {
  try {
    const content = readFileSync(specPath, 'utf8');
    const commits: string[] = [];
    const prdLinks: string[] = [];
    for (const line of content.split('\n').slice(0, 60)) {
      const commitsMatch = line.match(/\*\s+(?:EN\s+)?[Ss]ource commits:\s*(.+)/);
      if (commitsMatch?.[1]) {
        commits.push(commitsMatch[1].trim());
      }
      const prdMatch = line.match(/PRD\s*\(meegle\):\s*(https:\/\/[^\s|>)"\\]+)/);
      if (prdMatch?.[1] && !prdLinks.includes(prdMatch[1])) {
        prdLinks.push(prdMatch[1].trimEnd().replace(/[,;]+$/, ''));
      }
    }
    return { commits, prdLinks };
  } catch {
    return { commits: [], prdLinks: [] };
  }
}

function buildFailureDetails(outputLines: string[]): FailureDetail[] {
  return extractPlaywrightFailures(outputLines).map(({ specPath, errorSnippet }) => {
    const { commits, prdLinks } = readSpecMetadata(specPath);
    return { specPath, errorSnippet, commits, prdLinks };
  });
}

function tailLines(lines: string[], count: number) {
  return lines.slice(-count);
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function escapeLarkText(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function extractMetric(lines: string[], pattern: RegExp) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '--';
}

function detectTarget(command: string) {
  const pathMatch = command.match(/(tests\/[^\s]+\.spec\.ts|scripts\/[^\s]+\.sh|scripts\/[^\s]+\.ts)/);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  if (command.includes('playwright test')) {
    return 'playwright test';
  }

  return 'custom command';
}

function detectHighlight(lines: string[], status: 'SUCCESS' | 'FAILED') {
  const interestingLine = [...lines]
    .reverse()
    .find((line) => /error|failed|passed|candidates:|changed files:|summary/i.test(line));

  if (interestingLine) {
    return truncateText(interestingLine.trim(), 120);
  }

  return status === 'SUCCESS' ? 'Run completed successfully' : 'Run finished with errors';
}

function buildInsights(command: string, outputLines: string[], status: 'SUCCESS' | 'FAILED'): RunInsights {
  const passed = extractMetric(outputLines, /\b(\d+)\s+passed\b/i);
  const failed = extractMetric(outputLines, /\b(\d+)\s+failed\b/i);
  const changedFiles = extractMetric(outputLines, /changed files:\s*(\d+)/i);
  const candidates = extractMetric(outputLines, /candidates:\s*(\d+)/i);

  return {
    target: detectTarget(command),
    passed,
    failed,
    changedFiles,
    candidates,
    highlight: detectHighlight(outputLines, status),
  };
}

function buildLarkCard(params: {
  label: string;
  command: string;
  status: 'SUCCESS' | 'FAILED';
  exitCode: number;
  durationText: string;
  hostname: string;
  summaryLines: string;
  insights: RunInsights;
  failureDetails?: FailureDetail[];
}): LarkCardPayload {
  const { label, command, status, exitCode, durationText, hostname, summaryLines, insights, failureDetails } = params;
  const isSuccess = status === 'SUCCESS';
  const template = isSuccess ? 'green' : 'red';
  const statusEmoji = isSuccess ? '🟢' : '🔴';
  const bannerEmoji = isSuccess ? '✅' : '🚨';
  const safeSummary = escapeLarkText(truncateText(summaryLines || '<empty>', 1200));
  const safeCommand = escapeLarkText(truncateText(command, 300));
  const safeHighlight = escapeLarkText(insights.highlight);
  const safeTarget = escapeLarkText(insights.target);
  const safeHost = escapeLarkText(hostname);

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template,
        title: {
          tag: 'plain_text',
          content: `${bannerEmoji} ${label}`,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `${statusEmoji} **${isSuccess ? 'Passed' : 'Failed'}**\n${safeHighlight}`,
          },
        },
        {
          tag: 'column_set',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**Passed**\n${insights.passed}`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**Failed**\n${insights.failed}`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**Duration**\n${durationText}`,
                },
              ],
            },
          ],
        },
        {
          tag: 'column_set',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**Target**\n${safeTarget}`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**Changed files**\n${insights.changedFiles}`,
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: `**Candidates**\n${insights.candidates}`,
                },
              ],
            },
          ],
        },
        {
          tag: 'hr',
        },
        {
          tag: 'div',
          fields: [
            {
              is_short: false,
              text: {
                tag: 'lark_md',
                content: `**Command**\n\`${safeCommand}\`\n\n**Exit code**: ${exitCode}  |  **Host**: ${safeHost}`,
              },
            },
          ],
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**Last output**\n\`\`\`\n${safeSummary}\n\`\`\``,
          },
        },
        ...((!isSuccess && failureDetails && failureDetails.length > 0)
          ? [
              { tag: 'hr' },
              {
                tag: 'div',
                text: {
                  tag: 'lark_md',
                  content: `**Failure Details**\n\n${failureDetails
                    .map((fd) => {
                      const name = fd.specPath.split('/').pop() ?? fd.specPath;
                      const lines: string[] = [`**${escapeLarkText(name)}**`];
                      if (fd.errorSnippet) {
                        lines.push(`❌ ${escapeLarkText(truncateText(fd.errorSnippet, 200))}`);
                      }
                      if (fd.commits.length > 0) {
                        lines.push(`📝 ${fd.commits.map((c) => escapeLarkText(truncateText(c, 120))).join('\n   ')}`);
                      }
                      if (fd.prdLinks.length > 0) {
                        lines.push(`📋 PRD: ${fd.prdLinks.map((l) => `[${escapeLarkText(l)}](${l})`).join(' · ')}`);
                      }
                      return lines.join('\n');
                    })
                    .join('\n\n')}`,
                },
              },
            ]
          : []),
      ],
    },
  };
}

async function runCommand(commandArgs: string[]): Promise<RunResult> {
  return await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const outputBuffer: string[] = [];
    let trailingChunk = '';

    const command = formatCommandForDisplay(commandArgs);

    // 🔒 CRITICAL FIX: DO NOT MODIFY THIS SECTION
    // shell: true is REQUIRED for environment variables and cookie/auth setup
    // Changing to shell: false breaks anti-crawler mechanisms
    // Last broken by commit 63a0950 - this restores working functionality
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

async function postToLark(webhookUrl: string, cardPayload: LarkCardPayload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cardPayload),
  });

  if (!response.ok) {
    throw new Error(`Lark webhook request failed with status ${response.status}`);
  }

  const responsePayload = (await response.json()) as { code?: number; msg?: string };
  if (responsePayload.code && responsePayload.code !== 0) {
    throw new Error(`Lark webhook rejected message: ${responsePayload.msg ?? responsePayload.code}`);
  }
}

async function main() {
  loadDotenv();

  const webhookUrl = process.env.LARK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error('Missing LARK_WEBHOOK_URL environment variable.');
  }

  const { label, commandArgs } = parseArgs(process.argv.slice(2));
  const command = formatCommandForDisplay(commandArgs);
  const hostname = process.env.HOSTNAME ?? 'local';

  let exitCode = 1;
  let durationMs = 0;
  let outputLines: string[] = [];
  let runError: unknown;

  try {
    const result = await runCommand(commandArgs);
    exitCode = result.exitCode;
    durationMs = result.durationMs;
    outputLines = result.outputLines;
  } catch (error) {
    runError = error;
    outputLines = [error instanceof Error ? error.message : String(error)];
  }

  const status = exitCode === 0 && !runError ? 'SUCCESS' : 'FAILED';
  const insights = buildInsights(command, outputLines, status);
  const failureDetails = status === 'FAILED' ? buildFailureDetails(outputLines) : [];
  const summaryLines = tailLines(outputLines, 12)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');

  const message = buildLarkCard({
    label,
    command,
    status,
    exitCode,
    durationText: formatDuration(durationMs),
    hostname,
    summaryLines,
    insights,
    failureDetails,
  });

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