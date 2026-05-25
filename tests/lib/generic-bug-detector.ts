import { Page, expect } from '@playwright/test';

/**
 * Generic Bug Detector - For production automation monitoring
 * No PRD reference required, automatically discovers common online bugs
 */

export interface DetectedBug {
  id: string;
  issue: string;
  category: 'i18n' | 'error' | 'accessibility' | 'performance' | 'ui' | 'functional';
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  description: string;
  evidence: any;
  location?: string;
  screenshot?: Buffer;
  recommendation: string;
  detectionMethod: 'automatic' | 'ai-inspection';
  pageType?: 'flight-search' | 'flight-booking';
}

export class GenericBugDetector {
  private page: Page;
  private bugs: DetectedBug[] = [];
  private detectionStartTime: number;

  constructor(page: Page) {
    this.page = page;
    this.detectionStartTime = Date.now();
  }

  /**
   * Execute comprehensive automated bug audit
   * Focused on web desktop for flight-search and flight-booking flows
   */
  async runFullAudit(options?: {
    locale?: string;
    platform?: 'desktop' | 'mobile';
    pageType?: 'flight-search' | 'flight-booking';
    performanceBaseline?: { lcp: number; cls: number };
  }): Promise<DetectedBug[]> {
    // Only run on desktop for flight flows
    const platform = options?.platform || 'desktop';
    if (platform !== 'desktop') {
      console.log('⏭️  Skipping non-desktop platform');
      return this.bugs;
    }

    const pageType = options?.pageType || this.detectPageType();
    if (!pageType) {
      console.log('⏭️  Unknown page type, skipping detection');
      return this.bugs;
    }

    console.log(`🔍 Starting bug audit for ${pageType} on ${platform}...`);

    // 1. Internationalization check
    await this.checkI18nIssues(options?.locale || 'en-US');

    // 2. Error check
    await this.checkErrorPages();

    // 3. Accessibility check
    await this.checkAccessibilityIssues();

    // 4. Performance check
    await this.checkPerformanceIssues(options?.performanceBaseline);

    // 5. UI integrity
    await this.checkUIIntegrity();

    // 6. Network monitoring
    await this.checkNetworkRequests();

    // Store page context for training data
    this.bugs.forEach(bug => {
      bug.pageType = pageType;
    });

    console.log(`✅ Audit completed for ${pageType}, found ${this.bugs.length} issues`);
    return this.bugs;
  }

  /**
   * Check internationalization issues
   */
  private async checkI18nIssues(locale: string): Promise<void> {
    console.log('🌍 Checking internationalization issues...');

    // 1. Detect missing translations - showing untranslated keys
    const untranslatedKeys = await this.page.evaluate(() => {
      const pattern = /^[A-Z_][A-Z0-9_]{2,}$/;
      const allElements = Array.from(document.querySelectorAll('*'));
      const untranslated: string[] = [];

      for (const el of allElements) {
        const text = el.childNodes
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent?.trim())
          .filter(Boolean);

        for (const txt of text) {
          if (pattern.test(txt)) {
            untranslated.push(txt);
          }
        }
      }

      return [...new Set(untranslated)];
    });

    if (untranslatedKeys.length > 0) {
      this.bugs.push({
        id: `i18n_missing_${Date.now()}`,
        issue: 'missing_translations',
        category: 'i18n',
        severity: 'P1',
        description: `Found ${untranslatedKeys.length} untranslated keys`,
        evidence: { keys: untranslatedKeys.slice(0, 10) },
        recommendation: 'Check if translation files are missing or key naming is correct',
        detectionMethod: 'automatic',
      });
    }

    // 2. Detect text overflow - translated text too long
    const overflowElements = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="text"], button, label'))
        .filter(el => {
          return (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) &&
                 el.textContent?.length > 0;
        })
        .map(el => ({
          tag: el.tagName,
          text: el.textContent?.substring(0, 40),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        }))
        .slice(0, 5);
    });

    if (overflowElements.length > 0) {
      this.bugs.push({
        id: `i18n_overflow_${Date.now()}`,
        issue: 'text_overflow_i18n',
        category: 'i18n',
        severity: 'P2',
        description: `${overflowElements.length} elements have text overflow`,
        evidence: overflowElements,
        recommendation: 'Increase container size or reduce font size',
        detectionMethod: 'automatic',
      });
    }

    // 3. Detect character encoding issues
    const encodingIssues = await this.page.evaluate(() => {
      const suspiciousPatterns = [/\?{2,}/, /\u0000/, /[^\x20-\x7E]/];
      return Array.from(document.querySelectorAll('body *'))
        .filter(el => {
          const text = el.textContent || '';
          return text.match(/[\u0000\ufffd]/); // 无效字符
        })
        .map(el => el.textContent?.substring(0, 20))
        .slice(0, 3);
    });

    if (encodingIssues.length > 0) {
      this.bugs.push({
        id: `i18n_encoding_${Date.now()}`,
        issue: 'character_encoding',
        category: 'i18n',
        severity: 'P1',
        description: 'Character encoding issues detected (displayed as blocks or special symbols)',
        evidence: { samples: encodingIssues },
        recommendation: 'Check file encoding settings and database character set',
        detectionMethod: 'automatic',
      });
    }

    // 4. Check date format
    const dateFormatIssue = await this.checkDateFormat(locale);
    if (dateFormatIssue) {
      this.bugs.push(dateFormatIssue);
    }

    // 5. Check currency format
    const currencyIssue = await this.checkCurrencyFormat(locale);
    if (currencyIssue) {
      this.bugs.push(currencyIssue);
    }
  }

  /**
   * Check error pages and 404s
   */
  private async checkErrorPages(): Promise<void> {
    console.log('⚠️ Checking error pages...');

    // Monitor technical error information leakage
    const technicalErrors = await this.page.evaluate(() => {
      const pageText = document.documentElement.innerText;
      const technicalPatterns = [
        /stack trace/i,
        /exception/i,
        /undefined/i,
        /Cannot read property/i,
        /SQL error/i,
        /Internal Server Error/,
      ];

      return technicalPatterns
        .filter(p => p.test(pageText))
        .map(p => p.source);
    });

    if (technicalErrors.length > 0) {
      this.bugs.push({
        id: `error_technical_exposed_${Date.now()}`,
        issue: 'technical_error_exposed',
        category: 'error',
        severity: 'P2',
        description: 'Technical error messages exposed to users',
        evidence: { patterns: technicalErrors },
        recommendation: 'Replace technical error messages with user-friendly messages',
        detectionMethod: 'automatic',
      });
    }

    // Check if 404 page is user-friendly
    const pageStatus = (await this.page.goto(this.page.url()))?.status() || 200;
    if (pageStatus === 404) {
      const has404Message = await this.page.locator('text=/404|not found/i').isVisible().catch(() => false);

      if (!has404Message) {
        this.bugs.push({
          id: `error_poor_404_${Date.now()}`,
          issue: 'poor_404_page',
          category: 'error',
          severity: 'P2',
          description: 'Poor 404 page, missing clear error message',
          evidence: { statusCode: 404 },
          recommendation: 'Create a user-friendly 404 page with options to return home',
          detectionMethod: 'automatic',
        });
      }
    }
  }

  /**
   * Check accessibility issues
   */
  private async checkAccessibilityIssues(): Promise<void> {
    console.log('♿ Checking accessibility issues...');

    // 1. Missing alt text on images
    const imagesWithoutAlt = await this.page.locator('img:not([alt]), img[alt=""]').count();
    if (imagesWithoutAlt > 0) {
      this.bugs.push({
        id: `a11y_missing_alt_${Date.now()}`,
        issue: 'missing_alt_text',
        category: 'accessibility',
        severity: 'P2',
        description: `${imagesWithoutAlt} images missing alt text`,
        evidence: { count: imagesWithoutAlt },
        recommendation: 'Add descriptive alt text to all meaningful images',
        detectionMethod: 'automatic',
      });
    }

    // 2. Missing form labels
    const inputsWithoutLabel = await this.page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      return inputs.filter(input => {
        const hasAriaLabel = input.getAttribute('aria-label');
        const hasLabel = document.querySelector(`label[for="${input.id}"]`);
        const hasPlaceholder = input.getAttribute('placeholder');
        return !hasAriaLabel && !hasLabel && !hasPlaceholder;
      }).length;
    });

    if (inputsWithoutLabel > 0) {
      this.bugs.push({
        id: `a11y_missing_labels_${Date.now()}`,
        issue: 'missing_form_labels',
        category: 'accessibility',
        severity: 'P2',
        description: `${inputsWithoutLabel} form controls missing labels`,
        evidence: { count: inputsWithoutLabel },
        recommendation: 'Add associated label or aria-label to all form inputs',
        detectionMethod: 'automatic',
      });
    }

    // 3. Low contrast
    const contrastIssues = await this.page.evaluate(() => {
      const calculateLuminance = (r: number, g: number, b: number) => {
        const [rs, gs, bs] = [r, g, b].map(x => {
          const v = x / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      };

      const parseColor = (color: string) => {
        const match = color.match(/\d+/g);
        return match ? { r: +match[0], g: +match[1], b: +match[2] } : null;
      };

      const issues: any[] = [];
      const elements = document.querySelectorAll('button, a, [role="button"]');

      for (const el of elements) {
        const style = window.getComputedStyle(el);
        const fgColor = parseColor(style.color);
        const bgColor = parseColor(style.backgroundColor);

        if (fgColor && bgColor) {
          const l1 = calculateLuminance(fgColor.r, fgColor.g, fgColor.b);
          const l2 = calculateLuminance(bgColor.r, bgColor.g, bgColor.b);
          const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

          if (contrast < 4.5) {
            issues.push({
              element: el.textContent?.substring(0, 20),
              contrast: contrast.toFixed(2),
            });
          }
        }
      }

      return issues.slice(0, 3);
    });

    if (contrastIssues.length > 0) {
      this.bugs.push({
        id: `a11y_low_contrast_${Date.now()}`,
        issue: 'low_contrast',
        category: 'accessibility',
        severity: 'P3',
        description: `${contrastIssues.length} elements with insufficient contrast (<4.5:1)`,
        evidence: contrastIssues,
        recommendation: 'Increase text and background contrast to meet WCAG AA standard',
        detectionMethod: 'automatic',
      });
    }
  }

  /**
   * Check responsive design issues
   */
  private async checkResponsiveDesign(platform: 'mobile' | 'desktop'): Promise<void> {
    console.log('📱 Checking responsive design...');

    const viewports = platform === 'mobile'
      ? [
          { width: 375, height: 667, name: 'iPhone 8' },
          { width: 414, height: 896, name: 'iPhone 11' },
        ]
      : [
          { width: 1920, height: 1080, name: 'Desktop' },
        ];

    for (const vp of viewports) {
      await this.page.setViewportSize(vp);
      await this.page.waitForLoadState('networkidle').catch(() => {});

      const hasOverflow = await this.page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      if (hasOverflow) {
        this.bugs.push({
          id: `responsive_overflow_${Date.now()}`,
          issue: 'horizontal_overflow',
          category: 'ui',
          severity: 'P2',
          description: `Horizontal scroll detected on ${vp.name} (${vp.width}x${vp.height})`,
          evidence: { viewport: vp },
          recommendation: 'Check CSS layout and media query settings',
          detectionMethod: 'automatic',
        });
      }
    }
  }

  /**
   * Check performance issues
   */
  private async checkPerformanceIssues(baseline?: { lcp?: number; cls?: number }): Promise<void> {
    console.log('⚡ Checking performance metrics...');

    const metrics = await this.page.evaluate(() => {
      const perfData = performance.getEntriesByType('navigation')[0] as any;
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const clsEntries = performance.getEntriesByType('layout-shift').filter((e: any) => !e.hadRecentInput);

      return {
        lcp: lcpEntries.length ? lcpEntries[lcpEntries.length - 1].startTime : null,
        cls: clsEntries.reduce((sum: number, e: any) => sum + e.value, 0),
        fcp: perfData?.responseStart - perfData?.fetchStart,
        loadTime: perfData?.loadEventEnd - perfData?.fetchStart,
      };
    });

    const lcpThreshold = baseline?.lcp || 2500;
    const clsThreshold = baseline?.cls || 0.1;

    if (metrics.lcp && metrics.lcp > lcpThreshold) {
      this.bugs.push({
        id: `perf_slow_lcp_${Date.now()}`,
        issue: 'slow_lcp',
        category: 'performance',
        severity: 'P1',
        description: `LCP (Largest Contentful Paint) ${Math.round(metrics.lcp)}ms exceeds threshold ${lcpThreshold}ms`,
        evidence: metrics,
        recommendation: 'Optimize loading and rendering of critical content',
        detectionMethod: 'automatic',
      });
    }

    if (metrics.cls > clsThreshold) {
      this.bugs.push({
        id: `perf_high_cls_${Date.now()}`,
        issue: 'high_cls',
        category: 'performance',
        severity: 'P2',
        description: `CLS (Cumulative Layout Shift) ${metrics.cls.toFixed(3)} exceeds threshold ${clsThreshold}`,
        evidence: metrics,
        recommendation: 'Avoid undeclared media dimensions and dynamic content insertion',
        detectionMethod: 'automatic',
      });
    }
  }

  /**
   * Check UI integrity
   */
  private async checkUIIntegrity(): Promise<void> {
    console.log('🎨 Checking UI integrity...');

    // Detect inconsistent button states
    const buttonIssues = await this.page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const issues: any[] = [];

      for (const btn of buttons) {
        const isDisabled = (btn as HTMLButtonElement).disabled || btn.getAttribute('disabled') === '';
        const opacity = window.getComputedStyle(btn).opacity;
        const cursor = window.getComputedStyle(btn).cursor;
        const pointerEvents = window.getComputedStyle(btn).pointerEvents;

        if (isDisabled && (opacity === '1' || cursor === 'pointer' || pointerEvents !== 'none')) {
          issues.push({
            element: btn.textContent?.substring(0, 20),
            isDisabled,
            opacity,
            cursor,
          });
        }
      }

      return issues.slice(0, 3);
    });

    if (buttonIssues.length > 0) {
      this.bugs.push({
        id: `ui_button_state_${Date.now()}`,
        issue: 'inconsistent_button_state',
        category: 'ui',
        severity: 'P2',
        description: `${buttonIssues.length} buttons have inconsistent disabled state with visual appearance`,
        evidence: buttonIssues,
        recommendation: 'Ensure disabled buttons appear visually disabled (reduce opacity or change cursor)',
        detectionMethod: 'automatic',
      });
    }

    // Detect broken links
    const brokenLinks = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .filter(a => {
          const href = a.getAttribute('href');
          return href && (href === '#' || href === '' || href === 'javascript:void(0)');
        })
        .map(a => ({
          text: a.textContent?.substring(0, 20),
          href: a.getAttribute('href'),
        }))
        .slice(0, 5);
    });

    if (brokenLinks.length > 0) {
      this.bugs.push({
        id: `ui_broken_links_${Date.now()}`,
        issue: 'broken_links',
        category: 'ui',
        severity: 'P2',
        description: `${brokenLinks.length} invalid links (href empty or #)`,
        evidence: brokenLinks,
        recommendation: 'Provide valid href for all links or implement click handler',
        detectionMethod: 'automatic',
      });
    }
  }

  /**
   * Check network request issues
   */
  private async checkNetworkRequests(): Promise<void> {
    console.log('🌐 Checking network requests...');

    const networkIssues: { status: number; url: string }[] = [];

    this.page.on('response', response => {
      if (response.status() >= 400) {
        networkIssues.push({
          status: response.status(),
          url: response.url(),
        });
      }
    });

    // Wait a moment to capture network requests
    await this.page.waitForTimeout(2000);

    if (networkIssues.length > 0) {
      const grouped = networkIssues.reduce(
        (acc, issue) => {
          acc[issue.status] = (acc[issue.status] || 0) + 1;
          return acc;
        },
        {} as Record<number, number>
      );

      for (const [status, count] of Object.entries(grouped)) {
        const severity = parseInt(status) === 404 ? 'P2' : 'P1';
        this.bugs.push({
          id: `network_${status}_${Date.now()}`,
          issue: 'network_error',
          category: 'error',
          severity: severity as 'P1' | 'P2',
          description: `Detected ${count} HTTP ${status} errors`,
          evidence: {
            status: parseInt(status),
            count,
            examples: networkIssues.filter(i => i.status === parseInt(status)).slice(0, 2),
          },
          recommendation: status === '404' ? 'Check if resources exist' : 'Check server status',
          detectionMethod: 'automatic',
        });
      }
    }
  }

  /**
   * Helper: Check date format
   */
  private async checkDateFormat(locale: string): Promise<DetectedBug | null> {
    const dateFormats: Record<string, RegExp> = {
      'en-US': /\d{1,2}\/\d{1,2}\/\d{4}/,
      'en-GB': /\d{1,2}\/\d{1,2}\/\d{4}/,
      'id-ID': /\d{1,2}\/\d{1,2}\/\d{4}/,
      'de-DE': /\d{1,2}\.\d{1,2}\.\d{4}/,
      'fr-FR': /\d{1,2}\/\d{1,2}\/\d{4}/,
      'zh-CN': /\d{4}-\d{1,2}-\d{1,2}/,
    };

    const expectedFormat = dateFormats[locale];
    if (!expectedFormat) return null;

    const dateElements = await this.page.locator('[data-test*="date"], [class*="date"]').all();
    for (const el of dateElements) {
      const text = await el.textContent();
      if (text && !expectedFormat.test(text)) {
        return {
          id: `i18n_date_format_${Date.now()}`,
          issue: 'wrong_date_format',
          category: 'i18n',
          severity: 'P2',
          description: `Wrong date format for locale ${locale}`,
          evidence: { locale, found: text, expected: expectedFormat.source },
          recommendation: `Adjust date format for locale ${locale}`,
          detectionMethod: 'automatic',
        };
      }
    }

    return null;
  }

  /**
   * Helper: Check currency format
   */
  private async checkCurrencyFormat(locale: string): Promise<DetectedBug | null> {
    const currencyMaps: Record<string, string> = {
      'en-US': '$',
      'id-ID': 'Rp',
      'zh-CN': '¥',
      'en-GB': '£',
    };

    const expectedCurrency = currencyMaps[locale];
    if (!expectedCurrency) return null;

    const currencyElements = await this.page.locator('[class*="price"], [class*="currency"], [data-test*="price"]').all();

    for (const el of currencyElements) {
      const text = await el.textContent();
      if (text && !text.includes(expectedCurrency)) {
        return {
          id: `i18n_currency_format_${Date.now()}`,
          issue: 'wrong_currency_format',
          category: 'i18n',
          severity: 'P2',
          description: `Wrong currency format for locale ${locale}`,
          evidence: { locale, found: text, expected: expectedCurrency },
          recommendation: `Ensure correct currency symbol ${expectedCurrency} for locale ${locale}`,
          detectionMethod: 'automatic',
        };
      }
    }

    return null;
  }

  /**
   * Detect page type from URL
   */
  private detectPageType(): 'flight-search' | 'flight-booking' | null {
    const url = this.page.url();
    
    // Flight search: /en-en/flights/ or similar patterns
    if (url.includes('/flights/') && !url.includes('/booking')) {
      return 'flight-search';
    }
    
    // Flight booking: /booking/ in URL
    if (url.includes('/booking')) {
      return 'flight-booking';
    }
    
    return null;
  }

  /**
   * Get grouped and prioritized bugs
   */
  getBugsSummary() {
    const grouped: Record<string, DetectedBug[]> = {};

    for (const bug of this.bugs) {
      if (!grouped[bug.category]) {
        grouped[bug.category] = [];
      }
      grouped[bug.category].push(bug);
    }

    // 按优先级排序
    for (const category in grouped) {
      grouped[category].sort((a, b) => {
        const priorityScore = { P0: 1000, P1: 100, P2: 10, P3: 1 };
        return (priorityScore[b.severity] || 0) - (priorityScore[a.severity] || 0);
      });
    }

    return {
      total: this.bugs.length,
      byCategory: grouped,
      summary: {
        critical: this.bugs.filter(b => b.severity === 'P0').length,
        high: this.bugs.filter(b => b.severity === 'P1').length,
        medium: this.bugs.filter(b => b.severity === 'P2').length,
        low: this.bugs.filter(b => b.severity === 'P3').length,
      },
      executionTime: Date.now() - this.detectionStartTime,
    };
  }
}
