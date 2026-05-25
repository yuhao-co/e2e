#!/usr/bin/env tsx

/**
 * P0 Bug Analysis Script
 * Purpose: Analyze P0 critical bug detection rules and generated specs
 * Usage: npm run analyze:p0
 * 
 * This script:
 * 1. Validates P0 rules configuration
 * 2. Verifies generated specs include P0 detection
 * 3. Reports coverage and potential risks
 * 4. Does NOT require Playwright execution
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

interface P0Rule {
  id: string;
  name: string;
  description: string;
  checks: string[];
  impact: string;
  affectedFlows: string[];
}

interface P0Analysis {
  timestamp: string;
  rulesLoaded: number;
  flightSearchCoverage: number;
  flightBookingCoverage: number;
  generatedSpecsCount: number;
  p0IntegrationStatus: 'complete' | 'partial' | 'missing';
  issues: string[];
  recommendations: string[];
}

async function analyzeP0() {
  console.log('🚨 P0 Critical Bug Analysis\n');
  
  const analysis: P0Analysis = {
    timestamp: new Date().toISOString(),
    rulesLoaded: 0,
    flightSearchCoverage: 0,
    flightBookingCoverage: 0,
    generatedSpecsCount: 0,
    p0IntegrationStatus: 'missing',
    issues: [],
    recommendations: [],
  };

  // 1. Validate P0 rules configuration
  console.log('📋 Step 1: Validating P0 rules configuration...');
  const p0RulesPath = path.join(process.cwd(), 'config/p0-detection-rules.json');
  
  if (!fs.existsSync(p0RulesPath)) {
    console.error('❌ config/p0-detection-rules.json not found');
    analysis.issues.push('P0 rules configuration missing');
    process.exit(1);
  }

  const rulesContent = JSON.parse(fs.readFileSync(p0RulesPath, 'utf8'));
  analysis.rulesLoaded = rulesContent.rules?.length || 0;
  
  if (!rulesContent.rules || rulesContent.rules.length === 0) {
    console.error('❌ No P0 rules defined');
    analysis.issues.push('P0 rules are empty');
    process.exit(1);
  }

  console.log(`✅ Loaded ${analysis.rulesLoaded} P0 rules`);

  // Count coverage by flow
  const rules: P0Rule[] = rulesContent.rules;
  analysis.flightSearchCoverage = rules.filter(r => r.affectedFlows?.includes('flight-search')).length;
  analysis.flightBookingCoverage = rules.filter(r => r.affectedFlows?.includes('flight-booking')).length;

  console.log(`   - Flight-search: ${analysis.flightSearchCoverage} rules`);
  console.log(`   - Flight-booking: ${analysis.flightBookingCoverage} rules`);

  // 2. Verify generated specs include P0 detection
  console.log('\n📊 Step 2: Verifying generated specs...');
  
  const specsDir = path.join(process.cwd(), 'tests/web');
  const generatedSpecs = fs.readdirSync(specsDir)
    .filter(f => (f.startsWith('traveloka-flight-weekly-diff-') || f.includes('booking')) && f.endsWith('.spec.ts'))
    .map(f => path.join(specsDir, f));

  analysis.generatedSpecsCount = generatedSpecs.length;
  
  let specsWithP0 = 0;
  let specsWithoutP0 = 0;

  for (const spec of generatedSpecs) {
    const content = fs.readFileSync(spec, 'utf8');
    
    const hasGenericBugDetector = content.includes('GenericBugDetector');
    const hasP0Check = content.includes('severity === "P0"');
    const hasZeroTolerance = content.includes('toHaveLength(0)');

    if (hasGenericBugDetector && hasP0Check && hasZeroTolerance) {
      specsWithP0++;
    } else {
      specsWithoutP0++;
      if (!hasGenericBugDetector) {
        analysis.issues.push(`${path.basename(spec)}: Missing GenericBugDetector import`);
      }
      if (!hasP0Check) {
        analysis.issues.push(`${path.basename(spec)}: Missing P0 severity filter`);
      }
      if (!hasZeroTolerance) {
        analysis.issues.push(`${path.basename(spec)}: Missing zero-tolerance enforcement`);
      }
    }
  }

  if (generatedSpecs.length > 0) {
    console.log(`✅ Generated specs: ${specsWithP0}/${generatedSpecs.length} include P0 detection`);
    if (specsWithoutP0 > 0) {
      console.log(`⚠️  ${specsWithoutP0} spec(s) missing P0 integration`);
    }
  } else {
    console.log('⏭️  No generated specs found (run: npm run weekly-diff)');
    analysis.recommendations.push('Generate test specs using: npm run weekly-diff');
  }

  // 3. Check detector implementation
  console.log('\n🔍 Step 3: Checking P0 detector implementation...');
  
  const detectorPath = path.join(process.cwd(), 'tests/lib/generic-bug-detector.ts');
  if (!fs.existsSync(detectorPath)) {
    analysis.issues.push('GenericBugDetector not found');
    console.error('❌ tests/lib/generic-bug-detector.ts not found');
  } else {
    const detectorContent = fs.readFileSync(detectorPath, 'utf8');
    const hasDetectP0 = detectorContent.includes('detectP0Issues');
    const hasP0Calls = (detectorContent.match(/severity: 'P0'/g) || []).length;

    if (hasDetectP0) {
      console.log('✅ detectP0Issues() method implemented');
      console.log(`✅ ${hasP0Calls} P0 bug push calls found in detector`);
    } else {
      analysis.issues.push('detectP0Issues() method not implemented');
      console.error('❌ detectP0Issues() not found');
    }
  }

  // 4. Determine integration status
  console.log('\n📈 Step 4: Overall P0 integration status...');
  
  if (analysis.issues.length === 0 && analysis.rulesLoaded > 0 && specsWithP0 > 0) {
    analysis.p0IntegrationStatus = 'complete';
    console.log('✅ P0 detection FULLY INTEGRATED');
  } else if (analysis.rulesLoaded > 0 && analysis.issues.length < 3) {
    analysis.p0IntegrationStatus = 'partial';
    console.log('⚠️  P0 detection PARTIALLY INTEGRATED');
  } else {
    analysis.p0IntegrationStatus = 'missing';
    console.log('❌ P0 detection NOT PROPERLY INTEGRATED');
  }

  // 5. Print recommendations
  if (analysis.recommendations.length > 0 || analysis.issues.length > 0) {
    console.log('\n💡 Recommendations:');
    [
      ...analysis.issues.map(i => `❌ ${i}`),
      ...analysis.recommendations.map(r => `→ ${r}`),
    ].forEach(r => console.log(`   ${r}`));
  }

  // 6. Summary
  console.log('\n📊 Summary');
  console.log(`   Rules: ${analysis.rulesLoaded}`);
  console.log(`   Generated specs: ${analysis.generatedSpecsCount}`);
  console.log(`   Specs with P0: ${specsWithP0}/${generatedSpecs.length}`);
  console.log(`   Status: ${analysis.p0IntegrationStatus.toUpperCase()}`);

  // Exit with appropriate code
  if (analysis.p0IntegrationStatus === 'missing') {
    process.exit(1);
  }
  
  process.exit(0);
}

analyzeP0().catch(err => {
  console.error('❌ Analysis error:', err);
  process.exit(1);
});

