import { test, expect } from '@playwright/test';
import { GenericBugDetector } from '../lib/generic-bug-detector';

/**
 * Web Desktop Bug Detection - Flight Search & Booking
 * Scope: Web Desktop only, Flight Search and Flight Booking flows
 */

test.describe('Web Desktop Bug Detection', () => {
  test('Flight Search Results Page - Bug Detection', async ({ page }) => {
    // Navigate to flight search results
    await page.goto('https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15', {
      waitUntil: 'networkidle',
    });

    const detector = new GenericBugDetector(page);
    const bugs = await detector.runFullAudit({
      locale: 'en-US',
      platform: 'desktop',
      pageType: 'flight-search',
      performanceBaseline: { lcp: 2500, cls: 0.1 },
    });

    const summary = detector.getBugsSummary();

    console.log('\n📊 Flight Search Bug Report');
    console.log('='.repeat(50));
    console.log(`Total Issues: ${summary.total}`);
    console.log(`Execution Time: ${summary.executionTime}ms\n`);

    // By category
    for (const [category, categoryBugs] of Object.entries(summary.byCategory)) {
      if (categoryBugs.length > 0) {
        console.log(`\n📌 ${category.toUpperCase()} (${categoryBugs.length})`);
        categoryBugs.forEach(bug => {
          console.log(`[${bug.severity}] ${bug.issue}: ${bug.description}`);
        });
      }
    }

    // Severity summary
    console.log(`\n⚠️  Severity: P0=${summary.summary.critical} P1=${summary.summary.high} P2=${summary.summary.medium} P3=${summary.summary.low}`);
  });

  test('Flight Booking Page - Bug Detection', async ({ page }) => {
    // Navigate to booking page
    await page.goto('https://www.traveloka.com/en-en/booking', {
      waitUntil: 'networkidle',
    });

    const detector = new GenericBugDetector(page);
    const bugs = await detector.runFullAudit({
      locale: 'en-US',
      platform: 'desktop',
      pageType: 'flight-booking',
      performanceBaseline: { lcp: 3000, cls: 0.15 },
    });

    const summary = detector.getBugsSummary();

    console.log('\n📊 Flight Booking Bug Report');
    console.log('='.repeat(50));
    console.log(`Total Issues: ${summary.total}`);

    // Flag critical issues
    const criticalBugs = bugs.filter(b => b.severity === 'P0' || b.severity === 'P1');
    if (criticalBugs.length > 0) {
      console.log(`\n❌ CRITICAL ISSUES FOUND (${criticalBugs.length}):`);
      criticalBugs.forEach(bug => {
        console.log(`  [${bug.severity}] ${bug.issue}: ${bug.description}`);
      });
    }
  });

  test('Flight Search - Multi-locale Detection', async ({ page }) => {
    const locales = ['en-US', 'id-ID', 'zh-CN'];
    
    for (const locale of locales) {
      console.log(`\n🌍 Testing locale: ${locale}`);
      
      await page.goto('https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15', {
        waitUntil: 'networkidle',
      });

      const detector = new GenericBugDetector(page);
      const bugs = await detector.runFullAudit({
        locale,
        platform: 'desktop',
        pageType: 'flight-search',
      });

      const i18nBugs = bugs.filter(b => b.category === 'i18n');
      console.log(`  Found ${i18nBugs.length} i18n issues`);
      i18nBugs.forEach(bug => {
        console.log(`    - ${bug.issue}: ${bug.description}`);
      });
    }
  });

  test('Continuous Monitoring - Flight Search with Random Interactions', async ({ page }) => {
    await page.goto('https://www.traveloka.com/en-en/flights/CGK/NRT/2026-06-15', {
      waitUntil: 'networkidle',
    });

    const detector = new GenericBugDetector(page);
    const allBugs: any[] = [];

    // Simulate user interactions
    const interactions = [
      async () => await page.click('button, [role="button"]').catch(() => {}),
      async () => await page.click('a').catch(() => {}),
      async () => await page.keyboard.press('Tab').catch(() => {}),
      async () => await page.scroll(0, 300).catch(() => {}),
    ];

    // Run 5 iterations of interactions
    for (let i = 0; i < 5; i++) {
      // Random interaction
      const interaction = interactions[Math.floor(Math.random() * interactions.length)];
      await interaction();
      await page.waitForTimeout(500);

      // Run bug detection
      const bugs = await detector.runFullAudit({
        platform: 'desktop',
        pageType: 'flight-search',
      });
      allBugs.push(...bugs);
    }

    console.log(`\n📊 Continuous Monitoring Report`);
    console.log(`Total bugs found across 5 iterations: ${allBugs.length}`);
    
    // Group by issue type
    const byIssue: Record<string, number> = {};
    allBugs.forEach(bug => {
      byIssue[bug.issue] = (byIssue[bug.issue] || 0) + 1;
    });

    Object.entries(byIssue).forEach(([issue, count]) => {
      console.log(`  ${issue}: ${count}`);
    });
  });
});
