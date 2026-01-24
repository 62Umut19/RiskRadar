/**
 * Risk Calculation Utilities - Extracted for testability
 * These functions are used by dashboard.js and can be tested independently
 */

/**
 * Determine risk level based on score
 * @param {number} score - Risk score (0-100)
 * @returns {'critical'|'high'|'medium'|'low'} Risk level
 */
export function getRiskLevel(score) {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
}

/**
 * Get color for risk level
 * @param {number} score - Risk score (0-100)
 * @returns {string} Hex color code
 */
export function getRiskColor(score) {
    const level = getRiskLevel(score);
    const colors = {
        critical: '#ef4444',
        high: '#f97316',
        medium: '#eab308',
        low: '#22c55e'
    };
    return colors[level];
}

/**
 * Calculate business impact score
 * @param {Object} site - Site object with risks and criticality
 * @param {Object} criticalityWeights - Weight multipliers per criticality level
 * @returns {number} Impact score
 */
export function getImpactScore(site, criticalityWeights = null) {
    const weights = criticalityWeights || {
        critical: 1.5,
        high: 1.2,
        medium: 1.0,
        low: 0.8
    };
    const weight = weights[site.criticality] || 1.0;
    return site.risks.combined.score * weight;
}

/**
 * Get human-readable risk reason
 * @param {Object} site - Site object with risks
 * @returns {string} Risk reason description
 */
export function getRiskReason(site) {
    const fireScore = site.risks.fire.score;
    const quakeScore = site.risks.quake.score;

    const reasons = [];

    if (quakeScore > fireScore * 2) {
        reasons.push('Erdbeben +++');
        if (quakeScore > 80) reasons.push('seismische Zone');
    } else if (fireScore > quakeScore * 2) {
        reasons.push('Feuer +++');
        if (fireScore > 20) reasons.push('Trockenheit');
    } else {
        if (quakeScore > 50) reasons.push('Erdbeben ++');
        if (fireScore > 15) reasons.push('Feuer +');
    }

    if (site.criticality === 'critical') {
        reasons.push('kritischer Standort');
    }

    return reasons.length > 0 ? reasons.join(' | ') : 'Kombiniertes Risiko';
}

/**
 * Filter sites based on filter type
 * @param {Array} sites - Array of site objects
 * @param {string} filter - Filter type: 'all', 'critical', 'hub'
 * @returns {Array} Filtered and sorted sites
 */
export function filterSites(sites, filter) {
    let filtered = [...sites].sort(
        (a, b) => b.risks.combined.score - a.risks.combined.score
    );

    if (filter === 'critical') {
        filtered = filtered.filter(s => getRiskLevel(s.risks.combined.score) === 'critical');
    } else if (filter === 'hub') {
        filtered = filtered.filter(s => s.type === 'hub');
    }

    return filtered;
}
