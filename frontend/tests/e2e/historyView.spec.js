/**
 * E2E Tests for History View
 * Tests tab navigation, filter functionality, and event display
 */

import { test, expect } from '@playwright/test';

test.describe('History View', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test.describe('Tab Navigation', () => {
        test('should display both Forecast and History tabs', async ({ page }) => {
            const forecastTab = page.locator('.view-tab[data-view="forecast"]');
            const historyTab = page.locator('.view-tab[data-view="history"]');

            await expect(forecastTab).toBeVisible();
            await expect(historyTab).toBeVisible();
            await expect(forecastTab).toHaveClass(/active/);
        });

        test('should switch to History view when clicking History tab', async ({ page }) => {
            const historyTab = page.locator('.view-tab[data-view="history"]');

            await historyTab.click();

            await expect(historyTab).toHaveClass(/active/);
            await expect(page.locator('#history-view')).toBeVisible();
            await expect(page.locator('#forecast-view')).toBeHidden();
        });

        test('should switch back to Forecast view', async ({ page }) => {
            const forecastTab = page.locator('.view-tab[data-view="forecast"]');
            const historyTab = page.locator('.view-tab[data-view="history"]');

            // Switch to History
            await historyTab.click();
            await expect(page.locator('#history-view')).toBeVisible();

            // Switch back to Forecast
            await forecastTab.click();
            await expect(page.locator('#forecast-view')).toBeVisible();
            await expect(forecastTab).toHaveClass(/active/);
        });

        test('should update header info when switching views', async ({ page }) => {
            const historyTab = page.locator('.view-tab[data-view="history"]');

            // Initially Forecast indicators visible
            await expect(page.locator('#forecast-status')).toBeVisible();
            await expect(page.locator('#forecast-window')).toBeVisible();

            // After switching to History - forecast indicators hidden
            await historyTab.click();
            await expect(page.locator('#forecast-status')).toBeHidden();
            await expect(page.locator('#forecast-window')).toBeHidden();
        });
    });

    test.describe('History View Content', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('.view-tab[data-view="history"]').click();
            await page.waitForTimeout(1000); // Wait for map and data to load
        });

        test('should display history map', async ({ page }) => {
            const historyMap = page.locator('#history-map');
            await expect(historyMap).toBeVisible();

            // Check for Leaflet elements
            await expect(page.locator('#history-map.leaflet-container')).toBeVisible();
        });

        test('should display filter sidebar', async ({ page }) => {
            await expect(page.locator('.history-filters')).toBeVisible();
            await expect(page.locator('#history-time-range')).toBeVisible();
            await expect(page.locator('#show-fires')).toBeVisible();
            await expect(page.locator('#show-quakes')).toBeVisible();
        });

        test('should display statistics', async ({ page }) => {
            await expect(page.locator('#visible-fires-count')).toBeVisible();
            await expect(page.locator('#visible-quakes-count')).toBeVisible();
            await expect(page.locator('#visible-total-count')).toBeVisible();
        });

        test('should display legend', async ({ page }) => {
            const legend = page.locator('#history-view .legend');
            await expect(legend).toBeVisible();
            await expect(legend.locator('.legend-marker.fire-high')).toBeVisible();
            await expect(legend.locator('.legend-marker.quake-major')).toBeVisible();
        });
    });

    test.describe('Filter Controls', () => {
        test.beforeEach(async ({ page }) => {
            await page.locator('.view-tab[data-view="history"]').click();
            await page.waitForTimeout(1000);
        });

        test('should have time range dropdown with options', async ({ page }) => {
            const timeRange = page.locator('#history-time-range');
            await expect(timeRange).toBeVisible();

            const options = await timeRange.locator('option').all();
            expect(options).toHaveLength(4); // 7, 30, 60, 90 days
        });

        test('should have fire filter controls', async ({ page }) => {
            await expect(page.locator('#show-fires')).toBeChecked();
            await expect(page.locator('#fire-brightness-min')).toBeVisible();
            await expect(page.locator('#fire-count-min')).toBeVisible();
        });

        test('should have earthquake filter controls', async ({ page }) => {
            await expect(page.locator('#show-quakes')).toBeChecked();
            await expect(page.locator('#quake-magnitude-min')).toBeVisible();
            await expect(page.locator('#quake-depth-max')).toBeVisible();
        });

        test('should update stats when changing time range', async ({ page }) => {
            const initialCount = await page.locator('#visible-fires-count').textContent();

            // Change to 7 days
            await page.selectOption('#history-time-range', '7');
            await page.waitForTimeout(300);

            const newCount = await page.locator('#visible-fires-count').textContent();
            // Count should decrease with shorter time range
            expect(parseInt(newCount.replace(/\./g, ''))).toBeLessThanOrEqual(
                parseInt(initialCount.replace(/\./g, ''))
            );
        });

        test('should update stats when adjusting brightness filter', async ({ page }) => {
            const initialCount = await page.locator('#visible-fires-count').textContent();

            // Increase minimum brightness to 400K
            await page.locator('#fire-brightness-min').fill('400');
            await page.locator('#fire-brightness-min').dispatchEvent('input');
            await page.waitForTimeout(300);

            const newCount = await page.locator('#visible-fires-count').textContent();
            // Count should decrease with higher threshold
            expect(parseInt(newCount.replace(/\./g, ''))).toBeLessThanOrEqual(
                parseInt(initialCount.replace(/\./g, ''))
            );
        });

        test('should hide fires when toggling checkbox', async ({ page }) => {
            // Get initial fire count
            const fireCount = await page.locator('#visible-fires-count').textContent();
            expect(parseInt(fireCount.replace(/\./g, ''))).toBeGreaterThan(0);

            // Uncheck fires
            await page.locator('#show-fires').uncheck();
            await page.waitForTimeout(300);

            // Count should be 0
            const newCount = await page.locator('#visible-fires-count').textContent();
            expect(newCount).toBe('0');
        });

        test('should update display value when moving sliders', async ({ page }) => {
            // Brightness slider
            await page.locator('#fire-brightness-min').fill('450');
            await page.locator('#fire-brightness-min').dispatchEvent('input');
            await expect(page.locator('#fire-brightness-value')).toContainText('450K');

            // Magnitude slider
            await page.locator('#quake-magnitude-min').fill('5.5');
            await page.locator('#quake-magnitude-min').dispatchEvent('input');
            await expect(page.locator('#quake-magnitude-value')).toContainText('5.5');
        });
    });
});
