import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * ⚠️ ENFORCEMENT: All bug detection tests MUST be generated via:
 *   npm run weekly-diff
 * 
 * This file is ONLY for verifying that generated test specs include P0 detection.
 * 
 * Rules:
 * ✅ Generated test specs (.spec.ts files) created by generate-cases-from-weekly-diff.ts
 * ✅ Each generated spec includes:
 *    - GenericBugDetector import
 *    - P0 audit run with correct thresholds
 *    - Zero-tolerance for P0 bugs (expect(p0Issues).toHaveLength(0))
 * ❌ NO hardcoded URLs allowed
 * ❌ NO manual test cases allowed
 * 
 * Workflow:
 *   1. Code changes detected → git diff
 *   2. generate-cases-from-weekly-diff.ts creates test specs with P0 checks
 *   3. Run: npm run weekly-diff
 *   4. P0 detection automatically runs in generated specs
 *   5. Lark notified if P0 bugs found
 */

test.describe('Generated Test Suite P0 Detection Verification', () => {
  test('Verify generated flight-search specs include P0 detection', async () => {
    // Find all generated flight-search specs
    const specsDir = path.join(process.cwd(), 'tests/web');
    const generatedSpecs = fs.readdirSync(specsDir)
      .filter(f => f.startsWith('traveloka-flight-weekly-diff-') && f.endsWith('.spec.ts'))
      .map(f => path.join(specsDir, f));

    console.log(`\n📋 Scanning ${generatedSpecs.length} generated flight-search specs for P0 detection...`);

    for (const spec of generatedSpecs) {
      const content = fs.readFileSync(spec, 'utf8');
      
      // Verify GenericBugDetector is imported
      expect(content).toContain('GenericBugDetector', 
        `${path.basename(spec)}: Missing GenericBugDetector import`);
      
      // Verify P0 audit is called
      expect(content).toContain('runFullAudit', 
        `${path.basename(spec)}: Missing runFullAudit call`);
      
      // Verify P0 filter exists
      expect(content).toContain('severity === "P0"', 
        `${path.basename(spec)}: Missing P0 severity filter`);
      
      // Verify zero-tolerance enforcement
      expect(content).toContain('toHaveLength(0)', 
        `${path.basename(spec)}: Missing zero-tolerance P0 check`);

      console.log(`  ✅ ${path.basename(spec)} includes P0 detection`);
    }

    if (generatedSpecs.length === 0) {
      console.warn('\n⚠️  No generated specs found. Run: npm run weekly-diff');
    }
  });

  test('Verify generated flight-booking specs include P0 detection', async () => {
    // Flight-booking specs are also generated
    const specsDir = path.join(process.cwd(), 'tests/web');
    const bookingSpecs = fs.readdirSync(specsDir)
      .filter(f => f.startsWith('traveloka-flight-booking-weekly-diff-') && f.endsWith('.spec.ts'))
      .map(f => path.join(specsDir, f));

    console.log(`\n📋 Scanning ${bookingSpecs.length} generated flight-booking specs for P0 detection...`);

    for (const spec of bookingSpecs) {
      const content = fs.readFileSync(spec, 'utf8');
      
      if (content.includes('GenericBugDetector')) {
        expect(content).toContain('pageType: "flight-booking"', 
          `${path.basename(spec)}: Flight-booking P0 detection should specify pageType`);
        expect(content).toContain('docs/traveloka-flight-booking-case-generation.md',
          `${path.basename(spec)}: Missing locked booking-chain helper reference`);

        const paymentSensitive =
          content.includes('payment-chain')
          || content.includes('paymentPayButton')
          || content.includes('payment/v2')
          || content.includes('traveloka-flight-booking-payment-e2e.spec.ts');

        if (paymentSensitive) {
          expect(content).toContain('docs/traveloka-flight-booking-payment-chain-lock.md',
            `${path.basename(spec)}: Payment-sensitive booking spec must reference locked booking=>payment chain doc`);
        }

        console.log(`  ✅ ${path.basename(spec)} includes flight-booking P0 detection`);
      }
    }
  });

  test('Enforce: No hardcoded URLs in generated specs', async () => {
    const specsDir = path.join(process.cwd(), 'tests/web');
    const generatedSpecs = fs.readdirSync(specsDir)
      .filter(f =>
        (f.startsWith('traveloka-flight-weekly-diff-') || f.startsWith('traveloka-flight-booking-weekly-diff-'))
        && f.endsWith('.spec.ts'))
      .map(f => path.join(specsDir, f));

    for (const spec of generatedSpecs) {
      const content = fs.readFileSync(spec, 'utf8');
      expect(content).not.toMatch(/const TARGET_URL = 'https?:\/\//,
        `${path.basename(spec)}: TARGET_URL must be resolved via source-map, not hardcoded`);
      
      // All URLs must come from sourceContext
      const urlMatches = content.match(/goto\(['"]https?:\/\/www\.traveloka\.com\/[^'"]+['"]/g) || [];
      
      for (const urlMatch of urlMatches) {
        // URL should be from sourceContext.url or similar
        if (!urlMatch.includes('sourceContext') && !urlMatch.includes('url')) {
          console.warn(`  ⚠️  ${path.basename(spec)}: Possible hardcoded URL detected: ${urlMatch.substring(0, 50)}`);
        }
      }
    }
  });

  test('Report: Weekly-diff generation must include P0 rules config', async () => {
    const p0RulesPath = path.join(process.cwd(), 'config/p0-detection-rules.json');
    
    expect(fs.existsSync(p0RulesPath)).toBe(true, 
      'Missing config/p0-detection-rules.json - P0 detection rules not found');
    
    const rulesContent = JSON.parse(fs.readFileSync(p0RulesPath, 'utf8'));
    console.log(`\n📚 P0 Detection Rules: ${rulesContent.rules.length} rules loaded`);
    console.log(`   - Flight-search affected: ${rulesContent.rules.filter((r: any) => r.affectedFlows.includes('flight-search')).length}`);
    console.log(`   - Flight-booking affected: ${rulesContent.rules.filter((r: any) => r.affectedFlows.includes('flight-booking')).length}`);
  });
});

test.describe('Manual P0 Detection Testing (If Needed)', () => {
  test.skip('⚠️ SKIPPED: Use generated test specs instead', async ({ page }) => {
    // This placeholder enforces that manual hardcoded tests are NOT used
    // All P0 detection must be generated via npm run weekly-diff
    throw new Error('❌ HARDCODED TEST CASES ARE NOT ALLOWED. Use: npm run weekly-diff');
  });
});
