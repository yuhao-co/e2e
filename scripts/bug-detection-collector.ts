#!/usr/bin/env node

/**
 * Bug Detection Data Collection Pipeline
 * Integrates with weekly-diff workflow to collect bug detection data
 * for ML model training
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs', 'bug-detection');
const DATA_DIR = path.join(process.cwd(), 'data', 'bug-detection');
const TRAINING_DATA_FILE = path.join(DATA_DIR, 'training-data.jsonl');

interface BugDetectionRun {
  timestamp: string;
  url: string;
  locale: string;
  platform: 'desktop' | 'mobile';
  bugsDetected: any[];
  metrics: {
    executionTime: number;
    totalBugs: number;
    bugsBySeverity: Record<string, number>;
    bugsByCategory: Record<string, number>;
  };
}

interface TrainingRecord {
  id: string;
  timestamp: string;
  bugData: any;
  features: any;
  label: string;
  confidence: number;
}

class BugDetectionCollector {
  private logsDir: string;
  private dataDir: string;

  constructor() {
    this.logsDir = LOGS_DIR;
    this.dataDir = DATA_DIR;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.logsDir, this.dataDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Collect bug detection data from a test run
   */
  collectBugData(run: BugDetectionRun): void {
    const filename = `bug-detection-${Date.now()}.json`;
    const filepath = path.join(this.logsDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(run, null, 2));
    console.log(`✓ Bug detection data saved: ${filename}`);

    // Also append to training data file
    this.appendToTrainingData(run);
  }

  /**
   * Append normalized bug data to training dataset
   */
  private appendToTrainingData(run: BugDetectionRun): void {
    const records = run.bugsDetected.map((bug, idx) => {
      const record: TrainingRecord = {
        id: `${run.timestamp}-${idx}`,
        timestamp: run.timestamp,
        bugData: bug,
        features: this.extractFeatures(bug, run),
        label: bug.issue,
        confidence: 0.85, // Initial confidence
      };
      return record;
    });

    // Append to JSONL file
    records.forEach(record => {
      fs.appendFileSync(TRAINING_DATA_FILE, JSON.stringify(record) + '\n');
    });

    console.log(`✓ Added ${records.length} training records`);
  }

  /**
   * Extract ML-friendly features from bug data
   */
  private extractFeatures(bug: any, run: BugDetectionRun): Record<string, any> {
    return {
      // Bug properties
      category: bug.category,
      severity: bug.severity,
      issue: bug.issue,

      // Detection method
      detectionMethod: bug.detectionMethod,

      // Context
      locale: run.locale,
      platform: run.platform,
      url: run.url,

      // Frequency features
      evidenceSize: JSON.stringify(bug.evidence || {}).length,
      descriptionLength: bug.description?.length || 0,

      // Category statistics from run
      totalBugsInRun: run.metrics.totalBugs,
      bugsInCategoryInRun: run.metrics.bugsByCategory[bug.category] || 0,

      // Temporal feature
      hourOfDay: new Date(run.timestamp).getHours(),
      dayOfWeek: new Date(run.timestamp).getDay(),
    };
  }

  /**
   * Generate training dataset statistics
   */
  getStatistics(): any {
    if (!fs.existsSync(TRAINING_DATA_FILE)) {
      return { totalRecords: 0, message: 'No training data yet' };
    }

    const content = fs.readFileSync(TRAINING_DATA_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    const records = lines.map(l => JSON.parse(l));

    const stats = {
      totalRecords: records.length,
      byCategory: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      byIssue: {} as Record<string, number>,
    };

    records.forEach((record: any) => {
      const { category, severity, label } = record;
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
      stats.bySeverity[severity] = (stats.bySeverity[severity] || 0) + 1;
      stats.byIssue[label] = (stats.byIssue[label] || 0) + 1;
    });

    return stats;
  }

  /**
   * Export training data for model training
   */
  exportTrainingData(format: 'json' | 'csv' = 'json'): string {
    if (!fs.existsSync(TRAINING_DATA_FILE)) {
      throw new Error('No training data available');
    }

    const content = fs.readFileSync(TRAINING_DATA_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    const records = lines.map(l => JSON.parse(l));

    if (format === 'json') {
      return JSON.stringify(records, null, 2);
    }

    // CSV format
    if (records.length === 0) {
      return '';
    }

    const headers = Object.keys(records[0]).join(',');
    const rows = records.map(r => {
      return Object.values(r)
        .map(v => {
          if (typeof v === 'string') {
            return `"${v.replace(/"/g, '""')}"`;
          }
          return JSON.stringify(v);
        })
        .join(',');
    });

    return [headers, ...rows].join('\n');
  }

  /**
   * Validate and clean training data
   */
  validateTrainingData(): { valid: number; invalid: number; errors: string[] } {
    if (!fs.existsSync(TRAINING_DATA_FILE)) {
      return { valid: 0, invalid: 0, errors: ['Training data file not found'] };
    }

    const content = fs.readFileSync(TRAINING_DATA_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);

    let valid = 0;
    let invalid = 0;
    const errors: string[] = [];

    lines.forEach((line, idx) => {
      try {
        const record = JSON.parse(line);

        // Validate required fields
        if (!record.id || !record.label || !record.features) {
          errors.push(`Line ${idx + 1}: Missing required fields`);
          invalid++;
        } else {
          valid++;
        }
      } catch (e) {
        errors.push(`Line ${idx + 1}: Invalid JSON - ${(e as any).message}`);
        invalid++;
      }
    });

    // Remove invalid lines
    if (invalid > 0) {
      const validLines = lines.filter(line => {
        try {
          const record = JSON.parse(line);
          return record.id && record.label && record.features;
        } catch {
          return false;
        }
      });

      fs.writeFileSync(TRAINING_DATA_FILE, validLines.map(l => l + '\n').join(''));
      console.log(`✓ Cleaned ${invalid} invalid records`);
    }

    return { valid, invalid, errors };
  }
}

// CLI Interface
const command = process.argv[2];
const collector = new BugDetectionCollector();

switch (command) {
  case 'stats':
    console.log('Training Data Statistics:');
    console.log(JSON.stringify(collector.getStatistics(), null, 2));
    break;

  case 'export':
    const format = (process.argv[3] || 'json') as 'json' | 'csv';
    const data = collector.exportTrainingData(format);
    const exportFile = path.join(DATA_DIR, `training-data.${format}`);
    fs.writeFileSync(exportFile, data);
    console.log(`✓ Exported to ${exportFile}`);
    break;

  case 'validate':
    const validation = collector.validateTrainingData();
    console.log('Validation Results:');
    console.log(`  Valid: ${validation.valid}`);
    console.log(`  Invalid: ${validation.invalid}`);
    if (validation.errors.length > 0) {
      console.log('\nErrors:');
      validation.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
      if (validation.errors.length > 5) {
        console.log(`  ... and ${validation.errors.length - 5} more`);
      }
    }
    break;

  default:
    console.log(`
Usage: npx ts-node scripts/bug-detection-collector.ts <command>

Commands:
  stats      - Show training data statistics
  export     - Export training data (format: json|csv)
  validate   - Validate and clean training data

Example:
  npx ts-node scripts/bug-detection-collector.ts stats
  npx ts-node scripts/bug-detection-collector.ts export json
  npx ts-node scripts/bug-detection-collector.ts validate
    `);
}

export { BugDetectionCollector, BugDetectionRun, TrainingRecord };
