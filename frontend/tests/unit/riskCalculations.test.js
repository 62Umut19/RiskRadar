/**
 * Unit Tests for Risk Calculation Utilities
 */

import {
    getRiskLevel,
    getRiskColor,
    getImpactScore,
    getRiskReason,
    filterSites
} from '../../riskUtils.js';

describe('getRiskLevel', () => {
    test('returns "critical" for scores >= 75', () => {
        expect(getRiskLevel(75)).toBe('critical');
        expect(getRiskLevel(100)).toBe('critical');
        expect(getRiskLevel(85.5)).toBe('critical');
    });

    test('returns "high" for scores 50-74', () => {
        expect(getRiskLevel(50)).toBe('high');
        expect(getRiskLevel(74.9)).toBe('high');
        expect(getRiskLevel(60)).toBe('high');
    });

    test('returns "medium" for scores 25-49', () => {
        expect(getRiskLevel(25)).toBe('medium');
        expect(getRiskLevel(49.9)).toBe('medium');
        expect(getRiskLevel(35)).toBe('medium');
    });

    test('returns "low" for scores < 25', () => {
        expect(getRiskLevel(0)).toBe('low');
        expect(getRiskLevel(24.9)).toBe('low');
        expect(getRiskLevel(10)).toBe('low');
    });

    test('handles edge cases', () => {
        expect(getRiskLevel(-5)).toBe('low');
        expect(getRiskLevel(150)).toBe('critical');
    });
});

describe('getRiskColor', () => {
    test('returns correct colors for each level', () => {
        expect(getRiskColor(80)).toBe('#ef4444'); // critical - red
        expect(getRiskColor(60)).toBe('#f97316'); // high - orange
        expect(getRiskColor(35)).toBe('#eab308'); // medium - yellow
        expect(getRiskColor(10)).toBe('#22c55e'); // low - green
    });
});

describe('getImpactScore', () => {
    const baseSite = {
        risks: { combined: { score: 50 } },
        criticality: 'medium'
    };

    test('calculates impact score with default weights', () => {
        const site = { ...baseSite };
        expect(getImpactScore(site)).toBe(50); // 50 * 1.0
    });

    test('applies critical weight (1.5x)', () => {
        const site = { ...baseSite, criticality: 'critical' };
        expect(getImpactScore(site)).toBe(75); // 50 * 1.5
    });

    test('applies high weight (1.2x)', () => {
        const site = { ...baseSite, criticality: 'high' };
        expect(getImpactScore(site)).toBe(60); // 50 * 1.2
    });

    test('applies low weight (0.8x)', () => {
        const site = { ...baseSite, criticality: 'low' };
        expect(getImpactScore(site)).toBe(40); // 50 * 0.8
    });

    test('uses custom weights when provided', () => {
        const site = { ...baseSite };
        const customWeights = { medium: 2.0 };
        expect(getImpactScore(site, customWeights)).toBe(100); // 50 * 2.0
    });
});

describe('getRiskReason', () => {
    test('shows earthquake dominance', () => {
        const site = {
            risks: { fire: { score: 10 }, quake: { score: 85 } },
            criticality: 'medium'
        };
        const reason = getRiskReason(site);
        expect(reason).toContain('Erdbeben +++');
        expect(reason).toContain('seismische Zone');
    });

    test('shows fire dominance', () => {
        const site = {
            risks: { fire: { score: 30 }, quake: { score: 10 } },
            criticality: 'medium'
        };
        const reason = getRiskReason(site);
        expect(reason).toContain('Feuer +++');
        expect(reason).toContain('Trockenheit');
    });

    test('shows critical site status', () => {
        const site = {
            risks: { fire: { score: 10 }, quake: { score: 10 } },
            criticality: 'critical'
        };
        const reason = getRiskReason(site);
        expect(reason).toContain('kritischer Standort');
    });

    test('returns default for balanced low risks', () => {
        const site = {
            risks: { fire: { score: 5 }, quake: { score: 5 } },
            criticality: 'low'
        };
        expect(getRiskReason(site)).toBe('Kombiniertes Risiko');
    });
});

describe('filterSites', () => {
    const testSites = [
        { name: 'Site A', type: 'hub', risks: { combined: { score: 80 } } },
        { name: 'Site B', type: 'depot', risks: { combined: { score: 30 } } },
        { name: 'Site C', type: 'hub', risks: { combined: { score: 50 } } },
        { name: 'Site D', type: 'depot', risks: { combined: { score: 90 } } },
    ];

    test('returns all sites sorted by risk when filter is "all"', () => {
        const result = filterSites(testSites, 'all');
        expect(result).toHaveLength(4);
        expect(result[0].name).toBe('Site D'); // highest risk
        expect(result[3].name).toBe('Site B'); // lowest risk
    });

    test('filters critical sites only', () => {
        const result = filterSites(testSites, 'critical');
        expect(result).toHaveLength(2);
        expect(result.every(s => s.risks.combined.score >= 75)).toBe(true);
    });

    test('filters hub sites only', () => {
        const result = filterSites(testSites, 'hub');
        expect(result).toHaveLength(2);
        expect(result.every(s => s.type === 'hub')).toBe(true);
    });
});
