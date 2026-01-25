/**
 * E2E Tests for RiskRadar Control Tower Dashboard
 */

import { test, expect } from '@playwright/test';

test.describe('Dashboard Loading', () => {
    test('should load the dashboard with correct title', async ({ page }) => {
        await page.goto('/');

        await expect(page).toHaveTitle('RiskRadar Control Tower');
        await expect(page.locator('h1')).toContainText('RiskRadar');
    });

    test('should display the LIVE status indicator', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('.status-indicator')).toBeVisible();
        await expect(page.locator('.status-indicator')).toContainText('LIVE');
    });

    test('should display the 72h forecast window', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('.forecast-window')).toContainText('72h Forecast');
    });
});

test.describe('Site List', () => {
    test('should render site list after data loads', async ({ page }) => {
        await page.goto('/');

        // Wait for site list to be populated
        await page.waitForSelector('.site-item', { timeout: 10000 });

        const siteItems = page.locator('.site-item');
        await expect(siteItems.first()).toBeVisible();

        // Should have multiple sites
        const count = await siteItems.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should show critical count badge', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        const criticalBadge = page.locator('#critical-count');
        await expect(criticalBadge).toBeVisible();
        await expect(criticalBadge).toContainText('kritisch');
    });

    test('should display risk percentage for each site', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        const firstSiteRisk = page.locator('.site-item').first().locator('.site-risk');
        await expect(firstSiteRisk).toBeVisible();

        // Risk should contain percentage
        const riskText = await firstSiteRisk.textContent();
        expect(riskText).toMatch(/\d+(\.\d+)?%/);
    });
});

test.describe('Filter Buttons', () => {
    test('should have filter buttons available', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('.filter-btn[data-filter="all"]')).toBeVisible();
        await expect(page.locator('.filter-btn[data-filter="hub"]')).toBeVisible();
        await expect(page.locator('.filter-btn[data-filter="depot"]')).toBeVisible();
        await expect(page.locator('.filter-btn[data-filter="sortierzentrum"]')).toBeVisible();
    });

    test('should filter to depot sites when clicking Depots button', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        const initialCount = await page.locator('.site-item').count();

        // Click depot filter
        await page.locator('.filter-btn[data-filter="depot"]').click();

        // Wait for re-render
        await page.waitForTimeout(300);

        // Should have fewer or equal sites (only depots)
        const filteredCount = await page.locator('.site-item').count();
        expect(filteredCount).toBeLessThanOrEqual(initialCount);

        // Button should be active
        await expect(page.locator('.filter-btn[data-filter="depot"]')).toHaveClass(/active/);

        // All visible sites should be depots
        const siteTypes = page.locator('.site-item .site-type');
        const count = await siteTypes.count();
        for (let i = 0; i < count; i++) {
            const typeText = await siteTypes.nth(i).textContent();
            expect(typeText?.toLowerCase()).toContain('depot');
        }
    });

    test('should filter to hub sites when clicking Hubs button', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        // Click hub filter
        await page.locator('.filter-btn[data-filter="hub"]').click();

        await page.waitForTimeout(300);

        // All visible sites should be hubs
        const siteTypes = page.locator('.site-item .site-type');
        const count = await siteTypes.count();

        for (let i = 0; i < count; i++) {
            const typeText = await siteTypes.nth(i).textContent();
            expect(typeText?.toLowerCase()).toContain('hub');
        }
    });
});

test.describe('Site Details Panel', () => {
    test('should open site details when clicking a site', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        // Click first site
        await page.locator('.site-item').first().click();

        // Detail panel should become visible
        await expect(page.locator('.panel-right')).toBeVisible();
        await expect(page.locator('.site-detail-content')).toBeVisible();
    });

    test('should display site name in details panel', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        // Get first site name
        const firstSiteName = await page.locator('.site-item').first().locator('.site-name').textContent();

        // Click first site
        await page.locator('.site-item').first().click();

        // Detail panel should show the same site name
        await expect(page.locator('.site-detail-name')).toContainText(firstSiteName || '');
    });

    test('should close details panel when clicking close button', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        // Open site details
        await page.locator('.site-item').first().click();
        await expect(page.locator('.panel-right')).toBeVisible();

        // Click close button
        await page.locator('.site-detail-close').click();

        // Panel should be hidden
        await expect(page.locator('.panel-right')).toBeHidden();
    });

    test('should show fire and earthquake risk scores', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        await page.locator('.site-item').first().click();

        // Should have risk cards with percentages
        await expect(page.locator('.detail-risk-card.fire')).toBeVisible();
        await expect(page.locator('.detail-risk-card.quake')).toBeVisible();
    });
});

test.describe('Map', () => {
    test('should display the map container', async ({ page }) => {
        await page.goto('/');

        await expect(page.locator('#map')).toBeVisible();
    });

    test('should show legend overlay', async ({ page }) => {
        await page.goto('/');

        const forecastLegend = page.locator('#forecast-view .legend');
        await expect(forecastLegend).toBeVisible();
        await expect(forecastLegend.locator('.legend-title')).toContainText('Risiko-Level');
    });

    test('should have map fully loaded with tiles', async ({ page }) => {
        await page.goto('/');

        // Wait for Leaflet to load tiles
        await page.waitForSelector('.leaflet-tile-loaded', { timeout: 15000 });

        // Map should have tiles loaded
        const tiles = page.locator('.leaflet-tile-loaded');
        const tileCount = await tiles.count();
        expect(tileCount).toBeGreaterThan(0);
    });
});

test.describe('Metadata Display', () => {
    test('should show generation timestamp', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        const generatedAt = page.locator('#generated-at');
        await expect(generatedAt).not.toHaveText('Lade...');
        await expect(generatedAt).toContainText('Generiert:');
    });

    test('should show site count', async ({ page }) => {
        await page.goto('/');

        await page.waitForSelector('.site-item', { timeout: 10000 });

        const siteCount = page.locator('#site-count');
        await expect(siteCount).toContainText('Standorte');
    });
});
