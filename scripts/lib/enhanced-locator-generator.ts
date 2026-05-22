/**
 * Enhanced Element Locator Generation
 * 
 * This module enhances test case generation with intelligent element locator strategies.
 * It combines data-testid, data-id, and semantic locators based on:
 * - Changed code patterns (Traveloka flight specific)
 * - Test context (desktop vs mobile)
 * - Component hierarchy (form controls, modals, sidebars)
 */

import * as path from 'node:path';

export interface LocatorStrategy {
  priority: number;
  selector: string;
  description: string;
  fallback?: string;
  validation?: string;
}

export interface EnhancedLocatorContext {
  domain: 'flight-search' | 'flight-booking';
  surface: 'search-home' | 'search-results' | 'booking';
  changedFiles: string[];
  concernType?: string;
}

export interface LocatorRecommendation {
  primary: LocatorStrategy;
  secondary: LocatorStrategy[];
  interactionCode: string;
  documentation: string;
}

/**
 * Known data-testid and data-id patterns from Traveloka flight
 */
const TRAVELOKA_FLIGHT_PATTERNS = {
  // Search form controls
  searchForm: {
    desktop: '[data-testid="desktop-default-form"]',
    mobile: '[data-testid="flight-search-form"]',
  },
  departureAirport: '[data-testid^="item_nimbus-autocomplete-airport-"]',
  departureAirportItem: (code: string) => 
    `[data-testid="item_nimbus-autocomplete-airport-${code.toLowerCase()}"]`,
  departureDateContainer: '[data-id="departure-date-container"]',
  returnDateContainer: '[data-id="return-date-container"]',
  dateCell: (year: number, month: number, day: number) =>
    `[data-id="date-cell-${year}-${month}-${day}"]`,
  
  // Trip type controls
  tripTypeTab: '[data-id="oneway-roundtrip-tab"]',
  oneWayTab: '[data-testid="oneway-tab"]',
  roundTripTab: '[data-testid="roundtrip-tab"]',
  
  // Passenger controls
  passengersContainer: '[data-id="passengers-container"]',
  adultStepper: '[data-id="passengers-stepper-plus-adult"]',
  adultMinusStepper: '[data-id="passengers-stepper-minus-adult"]',
  childRow: '[data-id="passengers-row-child"]',
  infantRow: '[data-id="passengers-row-infant"]',
  
  // Cabin class
  cabinClassControl: '[data-id="IcTransportSeatClass"]',
  
  // Search button
  searchButton: '[data-testid="desktop-default-search-button"]',
  
  // Results page
  sidebar: '[data-testid="flight-search-sidebar-filter"]',
  resultsCard: '[data-testid^="flight-inventory-card"]',
  selectButton: '[data-testid="button_ticket_option_select"]',
  
  // Header & Navigation
  searchIcon: '[data-id="IcSystemSearch"]',
  chevronDown: '[data-id="IcSystemChevronDown"]',
  
  // Modals & Dialogs
  modalOverlay: '[data-testid*="modal"]',
  dialogOverlay: '[data-testid*="dialog"]',
};

/**
 * Analyze changed files to recommend locator strategies
 */
export function analyzeChangedFiles(changedFiles: string[]): string[] {
  const patterns: string[] = [];
  
  for (const file of changedFiles) {
    const fileName = path.basename(file).toLowerCase();
    const dirPath = file.toLowerCase();
    
    // Search form changes
    if (dirPath.includes('search-form') || dirPath.includes('input') || 
        fileName.includes('form')) {
      patterns.push('search-form-control');
    }
    
    // Date picker changes
    if (dirPath.includes('date') || fileName.includes('date')) {
      patterns.push('date-picker');
    }
    
    // Passenger selection changes
    if (dirPath.includes('passenger') || fileName.includes('passenger')) {
      patterns.push('passenger-selector');
    }
    
    // Sidebar/filter changes
    if (dirPath.includes('sidebar') || dirPath.includes('filter') ||
        fileName.includes('sidebar')) {
      patterns.push('sidebar-filter');
    }
    
    // Results changes
    if (dirPath.includes('result') || dirPath.includes('card') ||
        fileName.includes('result')) {
      patterns.push('results-card');
    }
    
    // Modal/Popup changes
    if (dirPath.includes('modal') || dirPath.includes('popup') ||
        dirPath.includes('dialog')) {
      patterns.push('modal-interaction');
    }
  }
  
  return [...new Set(patterns)];
}

/**
 * Get element locator recommendations based on context
 */
export function getLocatorRecommendation(
  context: EnhancedLocatorContext,
): LocatorRecommendation {
  const patterns = analyzeChangedFiles(context.changedFiles);
  
  // Default recommendations by concern type
  if (context.concernType?.includes('search-form')) {
    return getSearchFormLocators(context);
  } else if (context.concernType?.includes('date')) {
    return getDatePickerLocators(context);
  } else if (context.concernType?.includes('filter') || 
             context.concernType?.includes('sidebar')) {
    return getSidebarFilterLocators(context);
  } else if (context.concernType?.includes('results')) {
    return getResultsPageLocators(context);
  }
  
  // Fallback based on changed files patterns
  if (patterns.includes('date-picker')) {
    return getDatePickerLocators(context);
  } else if (patterns.includes('sidebar-filter')) {
    return getSidebarFilterLocators(context);
  } else if (patterns.includes('results-card')) {
    return getResultsPageLocators(context);
  }
  
  // Generic fallback
  return getGenericLocator(context);
}

/**
 * Search form locators
 */
function getSearchFormLocators(context: EnhancedLocatorContext): LocatorRecommendation {
  const isDesktop = context.surface !== 'booking';
  
  return {
    primary: {
      priority: 1,
      selector: isDesktop 
        ? TRAVELOKA_FLIGHT_PATTERNS.searchForm.desktop
        : TRAVELOKA_FLIGHT_PATTERNS.searchForm.mobile,
      description: 'Desktop or mobile search form container',
      validation: 'await expect(form).toBeVisible();',
    },
    secondary: [
      {
        priority: 2,
        selector: 'form[data-testid], form[data-id]',
        description: 'Any form with data attributes',
      },
      {
        priority: 3,
        selector: '[role="search"], form',
        description: 'Semantic search role or form element',
      },
    ],
    interactionCode: `
// Locate the search form with primary data-testid selector
const searchForm = page.locator('${isDesktop 
  ? TRAVELOKA_FLIGHT_PATTERNS.searchForm.desktop
  : TRAVELOKA_FLIGHT_PATTERNS.searchForm.mobile}');

// Verify form is visible before interacting
await expect(searchForm).toBeVisible();

// Interact with specific form control
// Example: Change departure airport
const departureInput = searchForm.locator(
  '[data-testid^="item_nimbus-autocomplete-airport-"]'
).first();
await departureInput.click();
    `,
    documentation: `
## Search Form Locator Strategy

**Primary Selector**: Uses data-testid attribute for desktop/mobile forms
- Desktop: [data-testid="desktop-default-form"]
- Mobile: [data-testid="flight-search-form"]

**Fallback**: Semantic role or HTML element matching

**Best Practice**: Always verify visibility before interaction
    `,
  };
}

/**
 * Date picker locators
 */
function getDatePickerLocators(context: EnhancedLocatorContext): LocatorRecommendation {
  return {
    primary: {
      priority: 1,
      selector: TRAVELOKA_FLIGHT_PATTERNS.departureDateContainer,
      description: 'Departure date container using data-id',
      validation: 'await expect(dateContainer).toBeVisible();',
    },
    secondary: [
      {
        priority: 2,
        selector: TRAVELOKA_FLIGHT_PATTERNS.returnDateContainer,
        description: 'Return date container for round-trip',
      },
      {
        priority: 3,
        selector: '[data-testid*="date"], [data-id*="date"]',
        description: 'Any element with date in attribute',
      },
    ],
    interactionCode: `
// Use data-id for date picker containers (not direct date-cell selection)
const departureContainer = page.locator('${TRAVELOKA_FLIGHT_PATTERNS.departureDateContainer}');

// Click to open the date picker modal
await departureContainer.click();

// Then select specific date using date-cell pattern
// Example: Select 2026-06-01
const targetDate = page.locator('[data-id="date-cell-2026-6-1"]');
await targetDate.click();
    `,
    documentation: `
## Date Picker Locator Strategy

**Key Insight**: Traveloka uses two-level structure:
1. Container level: data-id="*-date-container"
2. Cell level: data-id="date-cell-YYYY-M-D"

**Pattern**: Click container first to open modal, then click cell

**Avoid**: Direct CSS date selectors without data attributes

**Validation**: Always wait for date picker to be visible
    `,
  };
}

/**
 * Sidebar filter locators
 */
function getSidebarFilterLocators(context: EnhancedLocatorContext): LocatorRecommendation {
  return {
    primary: {
      priority: 1,
      selector: TRAVELOKA_FLIGHT_PATTERNS.sidebar,
      description: 'Flight search sidebar filter container',
      validation: 'await expect(sidebar).toBeVisible();',
    },
    secondary: [
      {
        priority: 2,
        selector: '[data-testid*="filter"], [data-id*="filter"]',
        description: 'Any filter-related element',
      },
      {
        priority: 3,
        selector: 'aside, nav, .sidebar, .filter',
        description: 'Semantic sidebar or filter role',
      },
    ],
    interactionCode: `
// Sidebar interactions - important two-step pattern for collapsed groups
const sidebar = page.locator('${TRAVELOKA_FLIGHT_PATTERNS.sidebar}');

// For collapsed sections like "Facilities > Baggage":
// Step 1: Click the chevron to expand
const chevron = sidebar.locator('[data-id="IcSystemChevronDown"]').first();
await chevron.click();

// Step 2: Then click the actual checkbox/option
const baggageOption = sidebar.locator('label, input[type="checkbox"]').filter({
  hasText: /baggage/i
}).first();
await baggageOption.click();
    `,
    documentation: `
## Sidebar Filter Locator Strategy

**Critical Pattern**: Collapsed sidebar groups use TWO-STEP interaction:
1. Click [data-id="IcSystemChevronDown"] to expand section
2. Then click the nested option's checkbox/control

**Example**: Facilities > Baggage requires both steps

**Avoid**: Clicking wrapper row directly without expanding chevron

**Validation**: Check visibility of options after chevron expansion
    `,
  };
}

/**
 * Results page locators
 */
function getResultsPageLocators(context: EnhancedLocatorContext): LocatorRecommendation {
  return {
    primary: {
      priority: 1,
      selector: '[data-testid^="flight-inventory-card"]',
      description: 'Flight result card container',
      validation: 'await expect(card).toBeVisible();',
    },
    secondary: [
      {
        priority: 2,
        selector: TRAVELOKA_FLIGHT_PATTERNS.selectButton,
        description: 'Select/Choose button within result',
      },
      {
        priority: 3,
        selector: '[role="button"], button',
        description: 'Semantic button role as fallback',
      },
    ],
    interactionCode: `
// Results page - select specific flight by semantic controls inside card
const resultCard = page.locator('[data-testid^="flight-inventory-card"]').first();

// Get the Choose button (semantic control inside card)
const chooseButton = resultCard.locator(
  '[data-testid="button_ticket_option_select"]'
).or(resultCard.locator('button:has-text("Choose")')).first();

// Click to select flight
await chooseButton.click();

// Verify navigation to booking
await page.waitForURL(/\\/booking/);
    `,
    documentation: `
## Results Page Locator Strategy

**Pattern**: Results use semantic controls inside data-testid cards
- Card: [data-testid^="flight-inventory-card"]
- Button: [data-testid="button_ticket_option_select_N"]

**Best Practice**: Prefer semantic controls (Choose, Details, Refund, etc.)
inside the card rather than broad [data-testid*=flight] matching

**Interaction Flow**: 
1. Find result card by data-testid
2. Locate semantic action button inside
3. Click to proceed to booking
    `,
  };
}

/**
 * Generic locator fallback
 */
function getGenericLocator(context: EnhancedLocatorContext): LocatorRecommendation {
  return {
    primary: {
      priority: 1,
      selector: '[data-testid], [data-id]',
      description: 'Any element with data attributes',
      validation: 'await expect(element).toBeVisible();',
    },
    secondary: [
      {
        priority: 2,
        selector: '[role], [aria-label]',
        description: 'Semantic ARIA attributes',
      },
    ],
    interactionCode: `
// Generic interaction pattern for flight domain
const element = page.locator('[data-testid], [data-id]').first();

// Wait for visibility and interact
await element.waitForElementState('visible');
await element.click();
    `,
    documentation: `
## Generic Locator Strategy

Use when specific pattern cannot be determined from changed files.

**Priority Order**:
1. data-testid attribute (most reliable)
2. data-id attribute (common in Traveloka)
3. Semantic ARIA attributes
4. Text matching as last resort
    `,
  };
}

/**
 * Generate interaction code with locator recommendations
 */
export function generateEnhancedInteractionCode(
  context: EnhancedLocatorContext,
  baseInteractionCode: string,
): string {
  const recommendation = getLocatorRecommendation(context);
  
  return `
// ============ Enhanced Element Locator Strategy ============
// ${recommendation.documentation.split('\n')[0]}
// Primary Selector: ${recommendation.primary.selector}
// Documentation: See below
//
${recommendation.documentation.split('\n').map(line => `// ${line}`).join('\n')}
// ============================================================

${recommendation.interactionCode}

// Original interaction pattern (fallback):
${baseInteractionCode}
  `;
}

/**
 * Suggest test case enhancements based on changed files
 */
export function suggestTestEnhancements(changedFiles: string[]): string[] {
  const suggestions: string[] = [];
  
  const patterns = analyzeChangedFiles(changedFiles);
  
  if (patterns.includes('date-picker')) {
    suggestions.push(
      '✓ Date picker changes detected - use data-id="*-date-container" for containers',
      '✓ Select dates with data-id="date-cell-YYYY-M-D" pattern',
    );
  }
  
  if (patterns.includes('sidebar-filter')) {
    suggestions.push(
      '✓ Sidebar filter changes detected - remember two-step expansion for collapsed groups',
      '✓ Click [data-id="IcSystemChevronDown"] first, then click option',
    );
  }
  
  if (patterns.includes('search-form-control')) {
    suggestions.push(
      '✓ Search form changes detected - use data-testid="desktop-default-form" for desktop',
      '✓ Airport selection uses data-testid="item_nimbus-autocomplete-airport-*" pattern',
    );
  }
  
  if (patterns.includes('results-card')) {
    suggestions.push(
      '✓ Results page changes detected - use semantic controls inside [data-testid^="flight-inventory-card"]',
      '✓ Select flights by Choose button with [data-testid="button_ticket_option_select_N"]',
    );
  }
  
  if (patterns.includes('modal-interaction')) {
    suggestions.push(
      '✓ Modal/Dialog changes detected - use [data-testid*="modal"] or [data-testid*="dialog"]',
      '✓ Always verify modal visibility before interaction',
    );
  }
  
  return suggestions;
}
