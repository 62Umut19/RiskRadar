/**
 * RiskRadar Control Tower - Dashboard JavaScript
 * Loads forecast data from JSON and renders an interactive Control Tower UI
 */

// ============================================
// Configuration
// ============================================
const CONFIG = {
    jsonDataPath: './data/forecast_data.json',
    metadataPath: './data/forecast_metadata.json',
    siteMetadataPath: './data/site_metadata.json',
    playbooksPath: './data/playbooks.json',
    eventsDataPath: './data/events_data.json',
    topRisksCount: 10,
    mapTileUrl: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    mapAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
};

const HISTORY_THRESHOLDS = {
    fireBrightnessHigh: 400,
    fireBrightnessExtreme: 450,
    quakeMagnitudeMajor: 6,
    quakeMagnitudeModerate: 4,
    quakeMagnitudeLabelModerate: 5
};

const HISTORY_MARKER_SIZES = {
    fire: { base: 3, scale: 3, max: 12 },
    quake: { base: 4, scale: 1.5, max: 18 }
};

const HISTORY_MARKER_COLORS = {
    fireHigh: '#ff4500',
    fireLow: '#ffa500',
    quakeMajor: '#8b0000',
    quakeModerate: '#8b5cf6',
    quakeMinor: '#a78bfa'
};

const HISTORY_POPUP_COLORS = {
    fireExtreme: '#ef4444',
    fireHigh: '#f97316',
    fireModerate: '#eab308',
    quakeMajor: '#ef4444',
    quakeModerate: '#8b5cf6',
    quakeMinor: '#a78bfa'
};

// ============================================
// Global State
// ============================================
let map = null;
let markers = [];
let forecastData = null;
let metadata = null;
let siteMetadata = null;
let playbooksData = null;
let selectedSite = null;
let currentFilters = new Set(['hub', 'depot', 'sortierzentrum']);
let currentSort = 'name-asc';

// History View State
let historyMap = null;
let eventsData = null;
let fireLayer = null;
let quakeLayer = null;
let currentView = 'forecast';

// ============================================
// Initialization
// ============================================
async function init() {
    try {
        await loadData();
        initMap();
        initViewTabs();
        window.addEventListener('resize', invalidateMapSize);
        renderMarkers();
        updateMetadataUI();
        renderSiteList();
        initFilterButtons();
        initGlobalTooltipHandlers();
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        showError(error.message);
    }
}

// ============================================
// Data Loading
// ============================================
async function loadData() {
    const [dataResponse, metaResponse, siteMetaResponse] = await Promise.all([
        fetch(CONFIG.jsonDataPath),
        fetch(CONFIG.metadataPath),
        fetch(CONFIG.siteMetadataPath).catch(() => null)
    ]);

    if (!dataResponse.ok) {
        throw new Error(`Failed to load forecast data: ${dataResponse.status}`);
    }
    if (!metaResponse.ok) {
        throw new Error(`Failed to load metadata: ${metaResponse.status}`);
    }

    forecastData = await dataResponse.json();
    metadata = await metaResponse.json();

    if (!forecastData || !Array.isArray(forecastData.sites)) {
        throw new Error('Invalid forecast data format: sites[] missing');
    }

    if (siteMetaResponse && siteMetaResponse.ok) {
        siteMetadata = await siteMetaResponse.json();
    } else {
        console.warn('Site metadata not found, using defaults');
        siteMetadata = { sites: {} };
    }

    if (!siteMetadata || typeof siteMetadata !== 'object') {
        siteMetadata = { sites: {} };
    } else if (!siteMetadata.sites || typeof siteMetadata.sites !== 'object') {
        siteMetadata.sites = {};
    }

    // Load playbooks
    try {
        const playbooksResponse = await fetch(CONFIG.playbooksPath);
        if (playbooksResponse.ok) {
            playbooksData = await playbooksResponse.json();
        } else {
            console.warn('Playbooks not found, using empty defaults');
            playbooksData = { playbooks: {} };
        }
    } catch {
        console.warn('Failed to load playbooks');
        playbooksData = { playbooks: {} };
    }

    // Enrich forecast data with site metadata
    enrichForecastData();
}

function enrichForecastData() {
    forecastData.sites = forecastData.sites.map(site => {
        const meta = siteMetadata.sites[site.name] || {};
        return {
            ...site,
            type: meta.type || 'depot',
            criticality: meta.criticality || 'medium',
            employees: meta.employees || 0,
            daily_throughput: meta.daily_throughput || 0,
            inventory_value_eur: meta.inventory_value_eur || 0,
            vehicles: meta.vehicles || {},
            goods_categories: meta.goods_categories || [],
            backup_sites: meta.backup_sites || [],
            sla_tier: meta.sla_tier || 'standard',
            region: meta.region || 'Unknown',
            country: meta.country || ''
        };
    });
}

// ============================================
// Risk Calculations
// ============================================
function getRiskLevel(score) {
    if (score >= 75) return 'critical';
    if (score >= 50) return 'high';
    if (score >= 25) return 'medium';
    return 'low';
}

function getRiskColor(score) {
    const level = getRiskLevel(score);
    const colors = {
        critical: '#ef4444',
        high: '#f97316',
        medium: '#eab308',
        low: '#22c55e'
    };
    return colors[level];
}

function getImpactColor(score) {
    if (score >= 7.5) return '#ef4444';
    if (score >= 5) return '#f97316';
    if (score >= 2.5) return '#eab308';
    return '#22c55e';
}

function getForecastWindow() {
    return 'nächste 72h';
}



function getImpactScore(site) {
    // 1. Financial Score (0-10)
    // Baseline: 100M EUR = 10 points
    const maxInventory = 100000000;
    let financialScore = (site.inventory_value_eur / maxInventory) * 10;
    if (financialScore > 10) financialScore = 10;

    // 2. Operational Score (0-10)
    // Baseline: 200,000 items/day = 10 points
    const maxThroughput = 200000;
    let operationalScore = (site.daily_throughput / maxThroughput) * 10;
    if (operationalScore > 10) operationalScore = 10;

    // 3. Strategic Criticality Score (0-10)
    const criticalityScores = {
        'critical': 10,
        'high': 7,
        'medium': 4,
        'low': 2
    };
    const strategicScore = criticalityScores[site.criticality] || 5;

    // Weighted Site Value Index (0-10)
    const siteValueIndex = (financialScore * 0.4) + (operationalScore * 0.3) + (strategicScore * 0.3);

    // Final Impact Score (0-10)
    const riskProb = site.risks.combined.score / 100;
    const finalScore = riskProb * siteValueIndex;

    return {
        score: finalScore,
        breakdown: {
            siteValueIndex: siteValueIndex,
            financialScore: financialScore,
            operationalScore: operationalScore,
            strategicScore: strategicScore,
            riskProb: riskProb
        }
    };
}

// ============================================
// Map Initialization
// ============================================
function initMap() {
    map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        zoomControl: true
    });

    L.tileLayer(CONFIG.mapTileUrl, {
        maxZoom: 19,
        attribution: CONFIG.mapAttribution
    }).addTo(map);
}

function invalidateMapSize() {
    if (!map) return;
    requestAnimationFrame(() => map.invalidateSize());
}

// ============================================
// Map Markers
// ============================================
function renderMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    forecastData.sites.forEach(site => {
        const score = site.risks.combined.score;
        const color = getRiskColor(score);
        const level = getRiskLevel(score);

        const marker = L.circleMarker([site.lat, site.lon], {
            radius: level === 'critical' ? 12 : 10,
            color: color,
            fillColor: color,
            fillOpacity: 0.8,
            weight: level === 'critical' ? 3 : 2
        });

        marker.bindPopup(createPopupHTML(site), { maxWidth: 320 });
        marker.bindTooltip(`${site.name}: ${score.toFixed(1)}%`, {
            sticky: true,
            className: 'dark-tooltip'
        });

        marker.on('click', () => selectSite(site));

        marker.addTo(map);
        markers.push(marker);
    });

    if (historyMap) {
        syncMapView(historyMap, map);
    }
}

function createPopupHTML(site) {
    const combined = site.risks.combined.score;
    const level = getRiskLevel(combined);
    const chipRgb = level === 'critical' ? '239,68,68' : level === 'high' ? '249,115,22' : level === 'medium' ? '234,179,8' : '34,197,94';
    const chipColor = getRiskColor(combined);

    return `
        <div class="popup-card popup-card-site">
            <div class="popup-header">
                <div class="popup-title">${site.name}</div>
                <span class="popup-chip" style="--chip-bg: rgba(${chipRgb}, 0.2); --chip-color: ${chipColor};">
                    ${site.type}
                </span>
            </div>

            <div class="popup-grid">
                <div class="popup-metric popup-metric--fire">
                    <div class="popup-metric-label">Feuer</div>
                    <div class="popup-metric-value">${site.risks.fire.score.toFixed(1)}%</div>
                </div>
                <div class="popup-metric popup-metric--quake">
                    <div class="popup-metric-label">Erdbeben</div>
                    <div class="popup-metric-value">${site.risks.quake.score.toFixed(1)}%</div>
                </div>
            </div>

            <div class="popup-highlight" style="--highlight-color: ${chipColor};">
                <div class="popup-highlight-label">Gesamt-Risiko</div>
                <div class="popup-highlight-value">${combined.toFixed(1)}%</div>
                <div class="popup-highlight-sub">${getForecastWindow()}</div>
            </div>


        </div>
    `;
}

// ============================================
// Site List
// ============================================


const SITE_SORTS = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'de'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'de'),
    'risk-asc': (a, b) => a.risks.combined.score - b.risks.combined.score,
    'risk-desc': (a, b) => b.risks.combined.score - a.risks.combined.score,
    'impact-asc': (a, b) => getImpactScore(a).score - getImpactScore(b).score,
    'impact-desc': (a, b) => getImpactScore(b).score - getImpactScore(a).score
};

function getSiteListItemMarkup(site) {
    const score = site.risks.combined.score;
    const level = getRiskLevel(score);
    const isSelected = selectedSite && selectedSite.name === site.name;
    const impactScore = getImpactScore(site).score;

    return `
        <button type="button" class="site-item level-${level} ${isSelected ? 'selected' : ''}" onclick="selectSiteByName('${site.name}')" ${isSelected ? 'aria-current="true"' : ''}>
            <span class="site-marker" aria-hidden="true"></span>
            <div class="site-info">
                <span class="site-name">${site.name}</span>
                <div class="site-meta">
                    <span class="site-type">${site.type}</span>
                    <span class="site-divider" aria-hidden="true">•</span>
                    <span class="site-region">${site.region}</span>
                </div>
            </div>
            <div class="site-metrics" style="--impact-color: ${getImpactColor(impactScore)};">
                <span class="site-impact">BIS ${impactScore.toFixed(1)}</span>
                <span class="site-risk">${score.toFixed(1)}%</span>
            </div>
        </button>
    `;
}

function renderSiteList() {
    const container = document.getElementById('site-list');
    if (!container || !forecastData) return;

    // Update critical count
    const criticalCount = forecastData.sites.filter(s => getRiskLevel(s.risks.combined.score) === 'critical').length;
    document.getElementById('critical-count').textContent = `${criticalCount} kritisch`;

    let sites = [...forecastData.sites];

    // Apply type filter
    if (currentFilters.size < 3) {
        sites = sites.filter(site => currentFilters.has(site.type));
    }

    // Apply sorting
    const sortFn = SITE_SORTS[currentSort] || SITE_SORTS['risk-desc'];
    sites.sort(sortFn);

    container.innerHTML = sites.map(getSiteListItemMarkup).join('');
}

// ============================================
// Site Selection & Details
// ============================================
function selectSiteByName(name) {
    const site = forecastData.sites.find(s => s.name === name);
    if (site) selectSite(site);
}

function selectSite(site) {
    selectedSite = site;

    // Update map view
    map.setView([site.lat, site.lon], 6);

    // Open popup
    markers.forEach(marker => {
        const latlng = marker.getLatLng();
        if (latlng.lat === site.lat && latlng.lng === site.lon) {
            marker.openPopup();
        }
    });

    // Show detail panel
    showSiteDetails(site);

    // Update site list selection
    renderSiteList();
}

function closeSiteDetails() {
    selectedSite = null;

    // Hide the entire right panel
    document.querySelector('.panel-right').style.display = 'none';
    invalidateMapSize();

    hideTooltip();

    // Close all popups
    markers.forEach(marker => marker.closePopup());

    // Update site list selection
    renderSiteList();
}

function showSiteDetails(site) {
    hideTooltip();

    // Show the right panel
    document.querySelector('.panel-right').style.display = 'flex';
    invalidateMapSize();

    const content = document.getElementById('site-detail-content');

    const level = getRiskLevel(site.risks.combined.score);
    const totalVehicles = (site.vehicles.trucks || 0) + (site.vehicles.vans || 0) + (site.vehicles.forklifts || 0);
    const impactData = getImpactScore(site);
    const impactScore = impactData.score;
    const criticalityLabel = {
        'critical': 'Kritisch',
        'high': 'Hoch',
        'medium': 'Mittel',
        'low': 'Niedrig'
    }[site.criticality] || site.criticality;

    const criticalityColor = {
        'critical': '#ef4444',
        'high': '#f97316',
        'medium': '#eab308',
        'low': '#22c55e'
    }[site.criticality] || '#9ca3af';

    const tooltipText = `Berechnung:\n` +
        `• Finanziell (${(site.inventory_value_eur / 1000000).toFixed(1)}M €): ${impactData.breakdown.financialScore.toFixed(1)}/10 (40%)\n` +
        `• Operationell (${(site.daily_throughput / 1000).toFixed(0)}k/Tag): ${impactData.breakdown.operationalScore.toFixed(1)}/10 (30%)\n` +
        `• Strategisch (${criticalityLabel}): ${impactData.breakdown.strategicScore.toFixed(1)}/10 (30%)\n` +
        `----------------\n` +
        `Site Value Index: ${impactData.breakdown.siteValueIndex.toFixed(2)}\n` +
        `× Risiko-Prob.: ${(impactData.breakdown.riskProb * 100).toFixed(1)}%`;

    content.innerHTML = `
        <div class="site-detail-header">
            <span class="site-detail-name">${site.name}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
                <div class="site-detail-badges">
                    <span class="badge" style="background: rgba(59,130,246,0.2); color: #3b82f6;">${site.type}</span>
                    <span class="badge" style="background: ${site.criticality === 'critical' ? 'rgba(239,68,68,0.2)' : 'rgba(156,163,175,0.2)'}; 
                           color: ${criticalityColor};">
                        ${criticalityLabel}
                    </span>
                </div>
                <button type="button" class="icon-button site-detail-close" onclick="closeSiteDetails()" title="Schließen" aria-label="Schließen">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
        
        <!-- Impact Score Banner -->
        <div class="impact-score-banner" style="background: linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(139,92,246,0.15) 100%); 
             border: 1px solid rgba(59,130,246,0.3); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px;">
                <div>
                    <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">
                        <i class="fas fa-bolt"></i> Business Impact Score
                    </div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: ${getImpactColor(impactScore)};">
                        ${impactScore.toFixed(1)}
                    </div>
                </div>
                <div style="text-align: right; font-size: 0.7rem; color: var(--text-secondary);">
                    <div>Probabilität: ${(impactData.breakdown.riskProb * 100).toFixed(1)}%</div>
                    <div>× Site Value: ${impactData.breakdown.siteValueIndex.toFixed(1)}</div>
                </div>
            </div>

            <div class="impact-tooltip-row">
                <button type="button" class="impact-tooltip-trigger" aria-expanded="false" aria-label="Berechnung des Business Impact Scores anzeigen">
                    <i class="fas fa-circle-info"></i> Berechnung
                </button>
            </div>
        </div>
        
        <div class="site-detail-risks">
            <div class="detail-risk-card fire">
                <div class="detail-risk-label">Feuer-Risiko</div>
                <div class="detail-risk-value" style="color: #f97316;">${site.risks.fire.score.toFixed(1)}%</div>
            </div>
            <div class="detail-risk-card quake">
                <div class="detail-risk-label">Erdbeben-Risiko</div>
                <div class="detail-risk-value" style="color: #8b5cf6;">${site.risks.quake.score.toFixed(1)}%</div>
            </div>
        </div>
        
        <!-- Business Context Section -->
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color);">
            <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 10px;">
                <i class="fas fa-building"></i> Business-Kontext
            </div>
            <div class="site-detail-meta">
                <div class="meta-item">
                    <i class="fas fa-users"></i>
                    <span class="meta-value">${site.employees.toLocaleString('de-DE')} MA</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-truck"></i>
                    <span class="meta-value">${totalVehicles} Fzg.</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-boxes"></i>
                    <span class="meta-value">${(site.daily_throughput / 1000).toFixed(0)}k/Tag</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-euro-sign"></i>
                    <span class="meta-value">${(site.inventory_value_eur / 1000000).toFixed(1)}M €</span>
                </div>
            </div>
        </div>
        
        <!-- Backup Sites -->
        ${site.backup_sites && site.backup_sites.length > 0 ? `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">
                    <i class="fas fa-exchange-alt"></i> Backup-Standorte
                </div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${site.backup_sites.map(b => {
        const backupSite = forecastData.sites.find(s => s.name === b);
        const backupRisk = backupSite ? backupSite.risks.combined.score : null;
        const backupLevel = backupRisk !== null ? getRiskLevel(backupRisk) : 'unknown';
        return `
                            <button type="button" class="backup-chip backup-chip-${backupLevel}" onclick="selectSiteByName('${b}')" title="${backupRisk !== null ? `Risiko: ${backupRisk.toFixed(1)}%` : 'Risiko unbekannt'}">
                                ${b}
                                ${backupRisk !== null ? `<span class="backup-risk">${backupRisk.toFixed(0)}%</span>` : ''}
                            </button>
                        `;
    }).join('')}
                </div>
            </div>
        ` : ''}
        
        <!-- Playbook Section -->
        ${getPlaybookHTML(site)}
    `;

    const impactTooltipTrigger = content.querySelector('.impact-tooltip-trigger');
    if (impactTooltipTrigger) {
        impactTooltipTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleTooltip(event, tooltipText);
        });
    }

    const impactScoreBanner = content.querySelector('.impact-score-banner');
    if (impactScoreBanner) {
        impactScoreBanner.addEventListener('click', (event) => {
            if (event.target.closest('.impact-tooltip-trigger')) return;
            event.stopPropagation();
            toggleTooltip(event, tooltipText);
        });
    }
}

// ============================================
// Playbook Rendering
// ============================================
function getPlaybookHTML(site) {
    if (!playbooksData || !playbooksData.playbooks) return '';

    // Determine primary risk driver
    const fireRisk = site.risks.fire?.score || 0;
    const quakeRisk = site.risks.quake?.score || 0;
    const combinedRisk = site.risks.combined?.score || 0;

    let riskType = 'combined';
    let primaryRisk = combinedRisk;

    if (fireRisk > quakeRisk && fireRisk > 25) {
        riskType = 'fire';
        primaryRisk = fireRisk;
    } else if (quakeRisk > fireRisk && quakeRisk > 25) {
        riskType = 'quake';
        primaryRisk = quakeRisk;
    }

    // Determine severity
    let severity = 'low';
    if (primaryRisk >= 75) severity = 'critical';
    else if (primaryRisk >= 50) severity = 'high';
    else if (primaryRisk >= 25) severity = 'medium';

    // Only show playbook if risk is at least medium
    if (severity === 'low') return '';

    const playbook = playbooksData.playbooks[riskType];
    if (!playbook) return '';

    // Filter measures by severity
    const severityOrder = ['low', 'medium', 'high', 'critical'];
    const currentSeverityIndex = severityOrder.indexOf(severity);
    const relevantMeasures = playbook.measures.filter(m => {
        const minIndex = severityOrder.indexOf(m.severity_min);
        return minIndex <= currentSeverityIndex;
    });

    const severityColors = {
        'critical': '#ef4444',
        'high': '#f97316',
        'medium': '#eab308'
    };

    return `
        <div class="playbook-section" style="margin-top: 16px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; border-left: 3px solid ${playbook.color};">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fas ${playbook.icon}" style="color: ${playbook.color};"></i>
                    <span style="font-weight: 600; font-size: 0.85rem;">${playbook.name}</span>
                </div>
                <span style="background: ${severityColors[severity]}22; color: ${severityColors[severity]}; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600;">
                    ${severity.toUpperCase()}
                </span>
            </div>
            
            <!-- Measures -->
            <div style="margin-bottom: 10px;">
                <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">
                    Maßnahmen
                </div>
                ${relevantMeasures.slice(0, 4).map(m => `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <span style="background: ${playbook.color}33; color: ${playbook.color}; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 600;">
                            ${m.priority}
                        </span>
                        <div style="flex: 1; font-size: 0.75rem;">${m.action}</div>
                        <div style="text-align: right; font-size: 0.65rem; color: var(--text-muted);">
                            <div>${m.owner}</div>
                            <div style="color: ${m.sla_hours <= 2 ? '#ef4444' : '#9ca3af'};">${m.sla_hours}h SLA</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            
        </div>
    `;
}

// ============================================
// Filter Buttons
// ============================================
function initFilterButtons() {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        // Set initial state based on default active class
        if (btn.classList.contains('active')) {
            currentFilters.add(btn.dataset.filter);
        }

        btn.setAttribute('aria-pressed', btn.classList.contains('active'));

        btn.addEventListener('click', () => {
            const filterType = btn.dataset.filter;
            const isActive = btn.classList.toggle('active');
            btn.setAttribute('aria-pressed', isActive);

            if (isActive) {
                currentFilters.add(filterType);
            } else {
                currentFilters.delete(filterType);
            }

            renderSiteList();
        });
    });

    // Initialize sort dropdown
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSort = e.target.value;
            renderSiteList();
        });
    }
}

// ============================================
// UI Updates
// ============================================
function updateMetadataUI() {
    const date = new Date(forecastData.generated_at);
    document.getElementById('generated-at').textContent =
        `Generiert: ${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    const siteCount = document.getElementById('site-count');
    if (siteCount) {
        siteCount.textContent = `${forecastData.sites.length} Standorte`;
    }
}

function showError(message) {
    document.getElementById('metadata').innerHTML =
        `<span style="color: #ef4444;">Fehler: ${message}</span>`;
}

// ============================================
// Focus Site (legacy support)
// ============================================
function focusSite(lat, lon) {
    const site = forecastData.sites.find(s => s.lat === lat && s.lon === lon);
    if (site) selectSite(site);
}

// ============================================
// View Tab Navigation
// ============================================
function initViewTabs() {
    const tabs = document.querySelectorAll('.view-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });
}

function switchView(viewName) {
    currentView = viewName;

    // Update tabs
    document.querySelectorAll('.view-tab').forEach(tab => {
        const isActive = tab.dataset.view === viewName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive);
    });

    // Show/hide views
    setElementDisplay('forecast-view', viewName === 'forecast' ? 'flex' : 'none');
    setElementDisplay('history-view', viewName === 'history' ? 'flex' : 'none');

    // Toggle header status indicators
    setElementDisplay('forecast-status', viewName === 'forecast' ? 'flex' : 'none');
    setElementDisplay('forecast-window', viewName === 'forecast' ? 'flex' : 'none');
    setElementDisplay('history-info', viewName === 'history' ? 'flex' : 'none');

    // Initialize history map on first switch
    if (viewName === 'history' && !historyMap) {
        initHistoryView();
    }

    if (viewName === 'forecast' && historyMap && map) {
        syncMapView(historyMap, map);
    }

    // Invalidate map sizes
    if (viewName === 'forecast' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
    if (viewName === 'history' && historyMap) {
        setTimeout(() => historyMap.invalidateSize(), 100);
    }
}

function setElementDisplay(id, displayValue) {
    const element = document.getElementById(id);
    if (element) {
        element.style.display = displayValue;
    }
}

function syncMapView(sourceMap, targetMap) {
    if (!sourceMap || !targetMap) return;
    const center = sourceMap.getCenter();
    const zoom = sourceMap.getZoom();
    targetMap.setView(center, zoom, { animate: false });
}

// ============================================
// History View
// ============================================
async function initHistoryView() {
    console.log('Initializing History View...');

    // Initialize history map
    historyMap = L.map('history-map', {
        center: [20, 0],
        zoom: 2,
        zoomControl: true
    });

    L.tileLayer(CONFIG.mapTileUrl, {
        maxZoom: 19,
        attribution: CONFIG.mapAttribution
    }).addTo(historyMap);

    // Create layer groups
    fireLayer = L.layerGroup().addTo(historyMap);
    quakeLayer = L.layerGroup().addTo(historyMap);

    // Load events data
    await loadEventsData();

    // Set default filter values
    setHistoryFilterDefaults();

    // Initialize filters
    initHistoryFilters();

    // Render events
    applyHistoryFilters();

    console.log('History View initialized');
}

async function loadEventsData() {
    try {
        console.log('Loading events data from:', CONFIG.eventsDataPath);
        const response = await fetch(CONFIG.eventsDataPath);
        if (!response.ok) throw new Error('Events data not found');
        eventsData = await response.json();
        eventsData = {
            ...eventsData,
            fires: Array.isArray(eventsData.fires) ? eventsData.fires : [],
            earthquakes: Array.isArray(eventsData.earthquakes) ? eventsData.earthquakes : []
        };
        console.log(`Loaded ${eventsData.fires?.length || 0} fires, ${eventsData.earthquakes?.length || 0} earthquakes`);
    } catch (error) {
        console.warn('Could not load events data:', error);
        eventsData = { fires: [], earthquakes: [] };
    }
}

function getStepDecimals(step) {
    const stepString = String(step);
    if (!stepString.includes('.')) return 0;
    return stepString.split('.')[1].length;
}

function setRangeToMidpoint(input) {
    if (!input) return null;
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    let step = parseFloat(input.step);
    if (!Number.isFinite(step) || step <= 0) step = 1;

    const midpoint = min + (max - min) / 2;
    const steps = Math.round((midpoint - min) / step);
    const value = min + steps * step;
    const decimals = getStepDecimals(step);
    const formatted = decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
    input.value = formatted;
    return parseFloat(formatted);
}

function setSelectToMidpoint(select) {
    if (!select) return;
    const options = Array.from(select.options);
    const values = options
        .map(option => parseFloat(option.value))
        .filter(Number.isFinite);
    if (values.length === 0) return;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const midpoint = min + (max - min) / 2;

    let closestOption = null;
    let smallestDiff = Number.POSITIVE_INFINITY;

    options.forEach(option => {
        const value = parseFloat(option.value);
        if (!Number.isFinite(value)) return;
        const diff = Math.abs(value - midpoint);
        if (diff < smallestDiff) {
            smallestDiff = diff;
            closestOption = option;
        }
    });

    if (closestOption) {
        select.value = closestOption.value;
    }
}

function setHistoryFilterDefaults() {
    setSelectToMidpoint(document.getElementById('history-time-range'));

    const brightnessValue = setRangeToMidpoint(document.getElementById('fire-brightness-min'));
    if (Number.isFinite(brightnessValue)) {
        document.getElementById('fire-brightness-value').textContent = `${brightnessValue}K`;
    }

    const countValue = setRangeToMidpoint(document.getElementById('fire-count-min'));
    if (Number.isFinite(countValue)) {
        document.getElementById('fire-count-value').textContent = `${countValue}`;
    }

    const magnitudeValue = setRangeToMidpoint(document.getElementById('quake-magnitude-min'));
    if (Number.isFinite(magnitudeValue)) {
        document.getElementById('quake-magnitude-value').textContent = magnitudeValue.toFixed(1);
    }

    const depthValue = setRangeToMidpoint(document.getElementById('quake-depth-max'));
    if (Number.isFinite(depthValue)) {
        document.getElementById('quake-depth-value').textContent = `${depthValue}km`;
    }
}

function getHistoryFilterElements() {
    return {
        timeRange: document.getElementById('history-time-range'),
        showFires: document.getElementById('show-fires'),
        fireBrightnessMin: document.getElementById('fire-brightness-min'),
        fireCountMin: document.getElementById('fire-count-min'),
        fireHighConfidence: document.getElementById('fire-high-confidence'),
        showQuakes: document.getElementById('show-quakes'),
        quakeMagnitudeMin: document.getElementById('quake-magnitude-min'),
        quakeDepthMax: document.getElementById('quake-depth-max')
    };
}

function parseEventDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const [year, month, day] = trimmed.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function formatEventDate(value, options) {
    const date = parseEventDate(value);
    if (!date) return '';
    return date.toLocaleDateString('de-DE', options);
}

function getHistoryReferenceDate() {
    return (
        parseEventDate(eventsData?.data_range?.end) ||
        parseEventDate(eventsData?.generated_at) ||
        new Date()
    );
}

function getHistoryCutoffDate(referenceDate, days) {
    const cutoffDate = new Date(referenceDate);
    cutoffDate.setDate(cutoffDate.getDate() - days);
    return cutoffDate;
}

function filterFireEvents(fires, filters, cutoffDate) {
    return fires.filter(fire => {
        const fireDate = parseEventDate(fire.date);
        if (!fireDate || fireDate < cutoffDate) return false;
        if (fire.brightness < filters.fireBrightnessMin) return false;
        if (fire.count < filters.fireCountMin) return false;
        if (filters.fireHighConfidence && fire.confidence !== 'high') return false;
        return true;
    });
}

function filterQuakeEvents(quakes, filters, cutoffDate) {
    return quakes.filter(quake => {
        const quakeDate = parseEventDate(quake.date);
        if (!quakeDate || quakeDate < cutoffDate) return false;
        if (quake.magnitude < filters.quakeMagnitudeMin) return false;
        if (quake.depth > filters.quakeDepthMax) return false;
        return true;
    });
}

function getFireMarkerRadius(count) {
    return Math.min(
        HISTORY_MARKER_SIZES.fire.base + Math.log10(count + 1) * HISTORY_MARKER_SIZES.fire.scale,
        HISTORY_MARKER_SIZES.fire.max
    );
}

function getQuakeMarkerRadius(magnitude) {
    return Math.min(
        HISTORY_MARKER_SIZES.quake.base + magnitude * HISTORY_MARKER_SIZES.quake.scale,
        HISTORY_MARKER_SIZES.quake.max
    );
}

function getFireMarkerColor(brightness) {
    return brightness >= HISTORY_THRESHOLDS.fireBrightnessHigh
        ? HISTORY_MARKER_COLORS.fireHigh
        : HISTORY_MARKER_COLORS.fireLow;
}

function getQuakeMarkerColor(magnitude) {
    if (magnitude >= HISTORY_THRESHOLDS.quakeMagnitudeMajor) return HISTORY_MARKER_COLORS.quakeMajor;
    if (magnitude >= HISTORY_THRESHOLDS.quakeMagnitudeModerate) return HISTORY_MARKER_COLORS.quakeModerate;
    return HISTORY_MARKER_COLORS.quakeMinor;
}

function getFireBrightnessPresentation(brightness) {
    if (brightness >= HISTORY_THRESHOLDS.fireBrightnessExtreme) {
        return { label: 'Extrem', color: HISTORY_POPUP_COLORS.fireExtreme };
    }
    if (brightness >= HISTORY_THRESHOLDS.fireBrightnessHigh) {
        return { label: 'Hoch', color: HISTORY_POPUP_COLORS.fireHigh };
    }
    return { label: 'Moderat', color: HISTORY_POPUP_COLORS.fireModerate };
}

function getQuakeMagnitudePresentation(magnitude) {
    if (magnitude >= HISTORY_THRESHOLDS.quakeMagnitudeMajor) {
        return { label: 'Stark', color: HISTORY_POPUP_COLORS.quakeMajor };
    }
    if (magnitude >= HISTORY_THRESHOLDS.quakeMagnitudeLabelModerate) {
        return { label: 'Moderat', color: HISTORY_POPUP_COLORS.quakeModerate };
    }
    return { label: 'Leicht', color: HISTORY_POPUP_COLORS.quakeMinor };
}

function initHistoryFilters() {
    const elements = getHistoryFilterElements();
    if (!elements.timeRange || !elements.showFires || !elements.fireBrightnessMin || !elements.fireCountMin ||
        !elements.showQuakes || !elements.quakeMagnitudeMin || !elements.quakeDepthMax) {
        console.warn('History filters missing required elements');
        return;
    }

    // Time range
    elements.timeRange.addEventListener('change', applyHistoryFilters);

    // Fire filters
    elements.showFires.addEventListener('change', (e) => {
        const fireFilters = document.getElementById('fire-filters');
        if (fireFilters) {
            fireFilters.style.opacity = e.target.checked ? '1' : '0.5';
        }
        applyHistoryFilters();
    });
    elements.fireBrightnessMin.addEventListener('input', (e) => {
        document.getElementById('fire-brightness-value').textContent = e.target.value + 'K';
        applyHistoryFilters();
    });
    elements.fireCountMin.addEventListener('input', (e) => {
        document.getElementById('fire-count-value').textContent = e.target.value;
        applyHistoryFilters();
    });
    if (elements.fireHighConfidence) {
        elements.fireHighConfidence.addEventListener('change', applyHistoryFilters);
    }

    // Quake filters
    elements.showQuakes.addEventListener('change', (e) => {
        const quakeFilters = document.getElementById('quake-filters');
        if (quakeFilters) {
            quakeFilters.style.opacity = e.target.checked ? '1' : '0.5';
        }
        applyHistoryFilters();
    });
    elements.quakeMagnitudeMin.addEventListener('input', (e) => {
        document.getElementById('quake-magnitude-value').textContent = parseFloat(e.target.value).toFixed(1);
        applyHistoryFilters();
    });
    elements.quakeDepthMax.addEventListener('input', (e) => {
        document.getElementById('quake-depth-value').textContent = e.target.value + 'km';
        applyHistoryFilters();
    });
}

function applyHistoryFilters() {
    const elements = getHistoryFilterElements();
    if (!elements.timeRange || !elements.showFires || !elements.fireBrightnessMin || !elements.fireCountMin ||
        !elements.showQuakes || !elements.quakeMagnitudeMin || !elements.quakeDepthMax) {
        console.warn('History filters missing required elements');
        return;
    }

    const filters = {
        days: parseInt(elements.timeRange.value),
        showFires: elements.showFires.checked,
        fireBrightnessMin: parseInt(elements.fireBrightnessMin.value),
        fireCountMin: parseInt(elements.fireCountMin.value),
        fireHighConfidence: elements.fireHighConfidence ? elements.fireHighConfidence.checked : false,
        showQuakes: elements.showQuakes.checked,
        quakeMagnitudeMin: parseFloat(elements.quakeMagnitudeMin.value),
        quakeDepthMax: parseInt(elements.quakeDepthMax.value)
    };

    const referenceDate = getHistoryReferenceDate();
    const cutoffDate = getHistoryCutoffDate(referenceDate, filters.days);

    const fireCount = renderFireEvents(filters, cutoffDate);
    const quakeCount = renderQuakeEvents(filters, cutoffDate);

    // Update total
    document.getElementById('visible-total-count').textContent =
        (fireCount + quakeCount).toLocaleString('de-DE');
}

function renderFireEvents(filters, cutoffDate) {
    fireLayer.clearLayers();

    if (!filters.showFires || !eventsData?.fires) {
        document.getElementById('visible-fires-count').textContent = '0';
        return 0;
    }

    const filteredFires = filterFireEvents(eventsData.fires, filters, cutoffDate);

    filteredFires.forEach(fire => {
        // Size based on count (aggregated fires)
        const baseRadius = getFireMarkerRadius(fire.count);
        const color = getFireMarkerColor(fire.brightness);

        const marker = L.circleMarker([fire.lat, fire.lon], {
            radius: baseRadius,
            color: color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 1
        });

        marker.bindPopup(createFirePopup(fire));
        marker.addTo(fireLayer);
    });

    document.getElementById('visible-fires-count').textContent =
        filteredFires.length.toLocaleString('de-DE');

    return filteredFires.length;
}

function renderQuakeEvents(filters, cutoffDate) {
    quakeLayer.clearLayers();

    if (!filters.showQuakes || !eventsData?.earthquakes) {
        document.getElementById('visible-quakes-count').textContent = '0';
        return 0;
    }

    const filteredQuakes = filterQuakeEvents(eventsData.earthquakes, filters, cutoffDate);

    filteredQuakes.forEach(quake => {
        // Size based on magnitude
        const radius = getQuakeMarkerRadius(quake.magnitude);
        const color = getQuakeMarkerColor(quake.magnitude);

        const marker = L.circleMarker([quake.lat, quake.lon], {
            radius: radius,
            color: color,
            fillColor: color,
            fillOpacity: 0.6,
            weight: 2
        });

        marker.bindPopup(createQuakePopup(quake));
        marker.addTo(quakeLayer);
    });

    document.getElementById('visible-quakes-count').textContent =
        filteredQuakes.length.toLocaleString('de-DE');

    return filteredQuakes.length;
}

function createFirePopup(fire) {
    const date = formatEventDate(fire.date, {
        day: '2-digit', month: '2-digit', year: 'numeric'
    }) || 'Unbekannt';
    const firstDate = fire.date_first ? formatEventDate(fire.date_first, {
        day: '2-digit', month: '2-digit', year: 'numeric'
    }) : '';

    const brightnessPresentation = getFireBrightnessPresentation(fire.brightness);
    const brightnessLevel = brightnessPresentation.label;
    const brightnessColor = brightnessPresentation.color;
    const confidenceLabel = fire.confidence === 'high' ? 'Hoch' : fire.confidence === 'nominal' ? 'Normal' : 'Niedrig';
    const confidenceClass = fire.confidence === 'high' ? 'popup-confidence-high'
        : fire.confidence === 'nominal' ? 'popup-confidence-medium'
            : 'popup-confidence-low';

    return `
        <div class="popup-card popup-card-fire">
            <div class="popup-header">
                <div class="popup-title">🔥 Feuer-Detektion</div>
                <span class="popup-chip" style="--chip-bg: rgba(249,115,22,0.2); --chip-color: ${HISTORY_POPUP_COLORS.fireHigh};">
                    ${fire.count} Detektionen
                </span>
            </div>

            <div class="popup-grid">
                <div class="popup-metric" style="--metric-color: ${brightnessColor};">
                    <div class="popup-metric-label">Max. Brightness</div>
                    <div class="popup-metric-value">${fire.brightness.toFixed(0)}K</div>
                </div>
                <div class="popup-metric" style="--metric-color: ${HISTORY_POPUP_COLORS.fireModerate};">
                    <div class="popup-metric-label">Ø Brightness</div>
                    <div class="popup-metric-value">${fire.brightness_avg?.toFixed(0) || 'N/A'}K</div>
                </div>
            </div>

            <div class="popup-highlight" style="--highlight-color: ${brightnessColor};">
                <div class="popup-highlight-label">Intensität</div>
                <div class="popup-highlight-value">${brightnessLevel}</div>
            </div>

            <div class="popup-details">
                <div class="popup-row">
                    <span>📅 Letztes Datum:</span>
                    <strong>${date}</strong>
                </div>
                ${firstDate && firstDate !== date ? `
                <div class="popup-row">
                    <span>📅 Erstes Datum:</span>
                    <strong>${firstDate}</strong>
                </div>
                ` : ''}
                ${fire.frp ? `
                <div class="popup-row">
                    <span>⚡ Max. FRP:</span>
                    <strong>${fire.frp.toFixed(1)} MW</strong>
                </div>
                ` : ''}
                <div class="popup-row">
                    <span>✓ Konfidenz:</span>
                    <strong class="${confidenceClass}">${confidenceLabel}</strong>
                </div>
            </div>
        </div>
    `;
}

function createQuakePopup(quake) {
    const date = formatEventDate(quake.date, {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) || 'Unbekannt';

    const magPresentation = getQuakeMagnitudePresentation(quake.magnitude);
    const magLevel = magPresentation.label;
    const magColor = magPresentation.color;
    const depthLevel = quake.depth <= 70 ? 'Flach' : quake.depth <= 300 ? 'Mittel' : 'Tief';

    return `
        <div class="popup-card popup-card-quake">
            <div class="popup-header">
                <div class="popup-title">🌍 Erdbeben</div>
                <span class="popup-chip" style="--chip-bg: rgba(139,92,246,0.2); --chip-color: ${HISTORY_POPUP_COLORS.quakeModerate};">
                    ${magLevel}
                </span>
            </div>

            <div class="popup-grid">
                <div class="popup-metric" style="--metric-color: ${magColor};">
                    <div class="popup-metric-label">Magnitude</div>
                    <div class="popup-metric-value">M${quake.magnitude.toFixed(1)}</div>
                </div>
                <div class="popup-metric" style="--metric-color: var(--accent-combined);">
                    <div class="popup-metric-label">Tiefe</div>
                    <div class="popup-metric-value">${quake.depth.toFixed(0)} km</div>
                    <div class="popup-metric-sub">${depthLevel}</div>
                </div>
            </div>

            <div class="popup-details">
                <div class="popup-row">
                    <span>📅 Datum:</span>
                    <strong>${date}</strong>
                </div>
                <div class="popup-row">
                    <span>📍 Ort:</span>
                    <strong>${quake.place}</strong>
                </div>
            </div>
        </div>
    `;
}


// ============================================
// Global Tooltip Helper
// ============================================
let tooltipEl = null;
let tooltipTarget = null;

function showTooltip(event, text) {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'custom-tooltip';
        tooltipEl.setAttribute('role', 'tooltip');
        tooltipEl.setAttribute('id', 'impact-tooltip');
        document.body.appendChild(tooltipEl);
    }

    tooltipEl.innerText = text;
    tooltipEl.style.display = 'block';
    tooltipEl.classList.add('visible');
    tooltipEl.setAttribute('aria-hidden', 'false');

    positionTooltip(event.currentTarget);
}

function positionTooltip(target) {
    if (!tooltipEl || !target) return;

    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();

    let top = rect.top - tooltipRect.height - 10;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

    if (top < 10) {
        top = rect.bottom + 10;
    }

    if (left + tooltipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tooltipRect.width - 10;
    }

    if (left < 10) {
        left = 10;
    }

    tooltipEl.style.top = `${top}px`;
    tooltipEl.style.left = `${left}px`;
}

function hideTooltip() {
    if (tooltipEl) {
        tooltipEl.classList.remove('visible');
        tooltipEl.setAttribute('aria-hidden', 'true');
        tooltipEl.style.display = 'none';
    }
    if (tooltipTarget) {
        tooltipTarget.setAttribute('aria-expanded', 'false');
        tooltipTarget.removeAttribute('aria-describedby');
        tooltipTarget = null;
    }
}

function toggleTooltip(event, text) {
    const isVisible = tooltipEl && tooltipEl.classList.contains('visible');
    const isSameTarget = tooltipTarget === event.currentTarget;

    if (isVisible && isSameTarget) {
        hideTooltip();
        return;
    }

    if (tooltipTarget && tooltipTarget !== event.currentTarget) {
        tooltipTarget.setAttribute('aria-expanded', 'false');
        tooltipTarget.removeAttribute('aria-describedby');
    }

    tooltipTarget = event.currentTarget;
    tooltipTarget.setAttribute('aria-expanded', 'true');
    tooltipTarget.setAttribute('aria-describedby', 'impact-tooltip');
    showTooltip(event, text);
}

function initGlobalTooltipHandlers() {
    document.addEventListener('click', (event) => {
        if (!tooltipEl || !tooltipEl.classList.contains('visible')) return;
        if (tooltipEl.contains(event.target)) return;
        if (event.target.closest('.impact-tooltip-trigger')) return;
        hideTooltip();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideTooltip();
        }
    });
}

// ============================================
// Initialize on DOM Ready
// ============================================
document.addEventListener('DOMContentLoaded', init);
