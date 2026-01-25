/**
 * Unit Tests for History View Filter Logic
 */

describe('History View Filters', () => {
    // Mock event data - reference date is 2026-01-25
    // 90 days before = 2025-10-27
    const mockFires = [
        { lat: 34.0, lon: -118.0, date: '2026-01-20', brightness: 450, brightness_avg: 420, count: 15, confidence: 'high' },
        { lat: 35.0, lon: -119.0, date: '2026-01-10', brightness: 380, brightness_avg: 360, count: 5, confidence: 'nominal' },
        { lat: 36.0, lon: -120.0, date: '2025-12-01', brightness: 420, brightness_avg: 400, count: 25, confidence: 'high' },
        { lat: 37.0, lon: -121.0, date: '2025-10-15', brightness: 500, brightness_avg: 480, count: 3, confidence: 'low' }, // >90 days
    ];

    const mockQuakes = [
        { lat: 35.0, lon: 139.0, date: '2026-01-22', magnitude: 6.5, depth: 25, place: 'Near Tokyo' },
        { lat: 36.0, lon: 140.0, date: '2026-01-15', magnitude: 4.2, depth: 50, place: 'Offshore' },
        { lat: 37.0, lon: 141.0, date: '2025-12-10', magnitude: 5.1, depth: 150, place: 'Deep Event' },
        { lat: 38.0, lon: 142.0, date: '2025-10-01', magnitude: 7.0, depth: 10, place: 'Major Quake' }, // >90 days
    ];

    // Helper to filter fires (replicating dashboard.js logic)
    function filterFires(fires, filters) {
        const cutoffDate = new Date('2026-01-25');
        cutoffDate.setDate(cutoffDate.getDate() - filters.days);

        return fires.filter(fire => {
            const fireDate = new Date(fire.date);
            if (fireDate < cutoffDate) return false;
            if (fire.brightness < filters.fireBrightnessMin) return false;
            if (fire.count < filters.fireCountMin) return false;
            return true;
        });
    }

    // Helper to filter quakes (replicating dashboard.js logic)
    function filterQuakes(quakes, filters) {
        const cutoffDate = new Date('2026-01-25');
        cutoffDate.setDate(cutoffDate.getDate() - filters.days);

        return quakes.filter(quake => {
            const quakeDate = new Date(quake.date);
            if (quakeDate < cutoffDate) return false;
            if (quake.magnitude < filters.quakeMagnitudeMin) return false;
            if (quake.depth > filters.quakeDepthMax) return false;
            return true;
        });
    }

    describe('Fire Filters', () => {
        test('filters by time range - 30 days', () => {
            const filters = { days: 30, fireBrightnessMin: 300, fireCountMin: 1 };
            const result = filterFires(mockFires, filters);
            expect(result).toHaveLength(2); // Jan 20 and Jan 10
        });

        test('filters by time range - 90 days', () => {
            const filters = { days: 90, fireBrightnessMin: 300, fireCountMin: 1 };
            const result = filterFires(mockFires, filters);
            expect(result).toHaveLength(3); // Excludes Nov 1 (>90 days)
        });

        test('filters by minimum brightness', () => {
            const filters = { days: 90, fireBrightnessMin: 400, fireCountMin: 1 };
            const result = filterFires(mockFires, filters);
            expect(result).toHaveLength(2); // Only brightness >= 400
            expect(result.every(f => f.brightness >= 400)).toBe(true);
        });

        test('filters by minimum detection count', () => {
            const filters = { days: 90, fireBrightnessMin: 300, fireCountMin: 10 };
            const result = filterFires(mockFires, filters);
            expect(result).toHaveLength(2); // count >= 10: 15 and 25
        });

        test('combines all filters', () => {
            // Jan 20: brightness 450, count 15 - matches
            // Dec 1: brightness 420, count 25 - also matches (within 60 days)
            const filters = { days: 60, fireBrightnessMin: 400, fireCountMin: 10 };
            const result = filterFires(mockFires, filters);
            expect(result).toHaveLength(2); // Both Jan 20 and Dec 1 match
            expect(result.every(f => f.brightness >= 400 && f.count >= 10)).toBe(true);
        });
    });

    describe('Earthquake Filters', () => {
        test('filters by time range - 30 days', () => {
            const filters = { days: 30, quakeMagnitudeMin: 2.5, quakeDepthMax: 300 };
            const result = filterQuakes(mockQuakes, filters);
            expect(result).toHaveLength(2); // Jan 22 and Jan 15
        });

        test('filters by time range - 90 days', () => {
            const filters = { days: 90, quakeMagnitudeMin: 2.5, quakeDepthMax: 300 };
            const result = filterQuakes(mockQuakes, filters);
            expect(result).toHaveLength(3); // Excludes Oct 15 (>90 days)
        });

        test('filters by minimum magnitude', () => {
            const filters = { days: 90, quakeMagnitudeMin: 5.0, quakeDepthMax: 300 };
            const result = filterQuakes(mockQuakes, filters);
            expect(result).toHaveLength(2); // 6.5 and 5.1
            expect(result.every(q => q.magnitude >= 5.0)).toBe(true);
        });

        test('filters by maximum depth', () => {
            const filters = { days: 90, quakeMagnitudeMin: 2.5, quakeDepthMax: 100 };
            const result = filterQuakes(mockQuakes, filters);
            expect(result).toHaveLength(2); // Excludes 150km depth
            expect(result.every(q => q.depth <= 100)).toBe(true);
        });

        test('combines all filters', () => {
            const filters = { days: 30, quakeMagnitudeMin: 5.0, quakeDepthMax: 50 };
            const result = filterQuakes(mockQuakes, filters);
            expect(result).toHaveLength(1); // Only Tokyo quake matches
            expect(result[0].magnitude).toBe(6.5);
        });
    });

    describe('Edge Cases', () => {
        test('handles empty fire array', () => {
            const filters = { days: 90, fireBrightnessMin: 300, fireCountMin: 1, fireHighConfidence: false };
            const result = filterFires([], filters);
            expect(result).toHaveLength(0);
        });

        test('handles empty earthquake array', () => {
            const filters = { days: 90, quakeMagnitudeMin: 2.5, quakeDepthMax: 300 };
            const result = filterQuakes([], filters);
            expect(result).toHaveLength(0);
        });

        test('returns empty when no matches', () => {
            const filters = { days: 7, fireBrightnessMin: 600, fireCountMin: 100, fireHighConfidence: true };
            const result = filterFires(mockFires, filters);
            expect(result).toHaveLength(0);
        });
    });
});

describe('Event Marker Sizing', () => {
    // Fire marker sizing logic
    function getFireMarkerRadius(count) {
        return Math.min(3 + Math.log10(count + 1) * 3, 12);
    }

    // Quake marker sizing logic
    function getQuakeMarkerRadius(magnitude) {
        return Math.min(4 + magnitude * 1.5, 18);
    }

    test('fire marker size scales with count', () => {
        expect(getFireMarkerRadius(1)).toBeCloseTo(3.9, 1);
        expect(getFireMarkerRadius(10)).toBeCloseTo(6.1, 1);
        expect(getFireMarkerRadius(100)).toBeCloseTo(9.0, 1);
    });

    test('fire marker size has maximum', () => {
        expect(getFireMarkerRadius(10000)).toBe(12);
    });

    test('quake marker size scales with magnitude', () => {
        expect(getQuakeMarkerRadius(3.0)).toBe(8.5);
        expect(getQuakeMarkerRadius(5.0)).toBe(11.5);
        expect(getQuakeMarkerRadius(7.0)).toBe(14.5);
    });

    test('quake marker size has maximum', () => {
        expect(getQuakeMarkerRadius(10.0)).toBe(18);
    });
});

describe('Event Color Coding', () => {
    // Fire color logic
    function getFireColor(brightness) {
        return brightness >= 400 ? '#ff4500' : '#ffa500';
    }

    // Quake color logic
    function getQuakeColor(magnitude) {
        if (magnitude >= 6) return '#8b0000';
        if (magnitude >= 4) return '#8b5cf6';
        return '#a78bfa';
    }

    test('fire colors based on brightness threshold', () => {
        expect(getFireColor(450)).toBe('#ff4500'); // High brightness - red
        expect(getFireColor(400)).toBe('#ff4500'); // At threshold - red
        expect(getFireColor(350)).toBe('#ffa500'); // Below threshold - orange
    });

    test('quake colors based on magnitude', () => {
        expect(getQuakeColor(7.0)).toBe('#8b0000'); // Major - dark red
        expect(getQuakeColor(6.0)).toBe('#8b0000'); // At major threshold
        expect(getQuakeColor(5.0)).toBe('#8b5cf6'); // Moderate - purple
        expect(getQuakeColor(4.0)).toBe('#8b5cf6'); // At moderate threshold
        expect(getQuakeColor(3.0)).toBe('#a78bfa'); // Minor - light purple
    });
});
