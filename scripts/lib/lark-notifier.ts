/**
 * Lark Notification Module
 * 
 * Sends test execution results to Lark webhook
 * Usage: Set LARK_WEBHOOK_URL environment variable
 */

import { config as loadDotenv } from 'dotenv';

loadDotenv();

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

export interface TestRunResult {
  totalRun: number;
  passed: number;
  failed: number;
  skipped: number;
  failedCases?: string[];
  duration?: number;
  mode?: string;
  layer?: 'active' | 'archive' | 'deep_archive';  // Phase 2: 分层信息
}

/**
 * Escape text for Lark markdown
 */
function escapeLarkText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms?: number): string {
  if (!ms) return 'N/A';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Build Lark card for test results
 */
function buildTestResultCard(result: TestRunResult): LarkCardPayload {
  const passed = result.passed;
  const failed = result.failed;
  const skipped = result.skipped;
  const total = result.totalRun;
  
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const status = failed > 0 ? '❌ FAILED' : '✅ PASSED';
  const statusColor = failed > 0 ? 'red' : 'green';
  
  const failedCasesText = result.failedCases && result.failedCases.length > 0
    ? `\n**Failed Cases**: ${result.failedCases.slice(0, 5).join(', ')}${result.failedCases.length > 5 ? ` +${result.failedCases.length - 5} more` : ''}`
    : '';
  
  // Phase 2: 添加分层信息
  const layerText = result.layer ? `\n**Layer**: ${result.layer} (周度/月度/按需)` : '';
  
  const summaryText = `
**Mode**: ${result.mode || 'full'}${layerText}
**Total**: ${total} | **Passed**: ${passed} | **Failed**: ${failed} | **Skipped**: ${skipped}
**Pass Rate**: ${passRate}%
**Duration**: ${formatDuration(result.duration)}${failedCasesText}
  `.trim();

  return {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template: statusColor,
        title: {
          tag: 'plain_text',
          content: `${status} Test Execution Results`,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: escapeLarkText(summaryText),
          },
        },
        {
          tag: 'hr',
        },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `**Timestamp**: ${new Date().toISOString()}\n**Script**: run-accumulated-cases.ts`,
          },
        },
      ],
    },
  };
}

/**
 * Post message to Lark webhook
 */
async function postToLark(webhookUrl: string, cardPayload: LarkCardPayload): Promise<void> {
  try {
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
      throw new Error(
        `Lark webhook rejected message: ${responsePayload.msg ?? responsePayload.code}`,
      );
    }

    console.log('[lark-notifier] Notification sent successfully');
  } catch (err) {
    console.error('[lark-notifier] Failed to send notification:', err);
    // Don't throw - notification failure shouldn't block the main process
  }
}

/**
 * Send test results to Lark
 */
export async function notifyTestResults(result: TestRunResult): Promise<void> {
  const webhookUrl = process.env.LARK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('[lark-notifier] LARK_WEBHOOK_URL not set, skipping notification');
    return;
  }

  console.log('[lark-notifier] Sending test results to Lark...');
  
  const card = buildTestResultCard(result);
  await postToLark(webhookUrl, card);
}

/**
 * Send custom message to Lark
 */
export async function notifyCustom(title: string, content: string, color: 'red' | 'green' | 'yellow' = 'green'): Promise<void> {
  const webhookUrl = process.env.LARK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('[lark-notifier] LARK_WEBHOOK_URL not set, skipping notification');
    return;
  }

  const card: LarkCardPayload = {
    msg_type: 'interactive',
    card: {
      config: {
        wide_screen_mode: true,
        enable_forward: true,
      },
      header: {
        template: color,
        title: {
          tag: 'plain_text',
          content: title,
        },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: escapeLarkText(content),
          },
        },
        {
          tag: 'div',
          text: {
            tag: 'plain_text',
            content: `Sent: ${new Date().toISOString()}`,
          },
        },
      ],
    },
  };

  await postToLark(webhookUrl, card);
}
