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
let currentFilter = 'all';
let currentSort = 'risk-desc';

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

function getForecastWindow() {
    return 'nächste 72h';
}

function getRiskReason(site) {
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

function getImpactScore(site) {
    const weights = siteMetadata.criticality_weights || {
        critical: 1.5,
        high: 1.2,
        medium: 1.0,
        low: 0.8
    };
    const weight = weights[site.criticality] || 1.0;
    return site.risks.combined.score * weight;
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

    if (forecastData.sites.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

function createPopupHTML(site) {
    const combined = site.risks.combined.score;
    const level = getRiskLevel(combined);

    return `
        <div style="font-family: 'Inter', sans-serif; min-width: 260px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <strong style="font-size: 1.1rem;">${site.name}</strong>
                <span style="background: rgba(${level === 'critical' ? '239,68,68' : level === 'high' ? '249,115,22' : level === 'medium' ? '234,179,8' : '34,197,94'}, 0.2); 
                       color: ${getRiskColor(combined)}; 
                       padding: 3px 10px; 
                       border-radius: 12px; 
                       font-size: 0.7rem;
                       text-transform: uppercase;">
                    ${site.type}
                </span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
                <div style="background: rgba(249,115,22,0.1); padding: 8px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: #9ca3af; text-transform: uppercase;">Feuer</div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: #f97316;">${site.risks.fire.score.toFixed(1)}%</div>
                </div>
                <div style="background: rgba(139,92,246,0.1); padding: 8px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 0.65rem; color: #9ca3af; text-transform: uppercase;">Erdbeben</div>
                    <div style="font-size: 1.2rem; font-weight: 700; color: #8b5cf6;">${site.risks.quake.score.toFixed(1)}%</div>
                </div>
            </div>
            
            <div style="background: rgba(59,130,246,0.1); padding: 10px; border-radius: 6px; text-align: center; margin-bottom: 10px;">
                <div style="font-size: 0.65rem; color: #9ca3af; text-transform: uppercase;">Gesamt-Risiko</div>
                <div style="font-size: 1.5rem; font-weight: 700; color: ${getRiskColor(combined)};">${combined.toFixed(1)}%</div>
                <div style="font-size: 0.7rem; color: #6b7280; margin-top: 4px;">nächste 72h</div>
            </div>
            
            <div style="font-size: 0.75rem; color: #9ca3af; display: flex; align-items: center; gap: 6px;">
                <span>💡</span>
                <span>${getRiskReason(site)}</span>
            </div>
        </div>
    `;
}

// ============================================
// Site List
// ============================================
const SITE_FILTERS = {
    hub: site => site.type === 'hub',
    depot: site => site.type === 'depot',
    sortierzentrum: site => site.type === 'sortierzentrum'
};

const SITE_SORTS = {
    'name-asc': (a, b) => a.name.localeCompare(b.name, 'de'),
    'name-desc': (a, b) => b.name.localeCompare(a.name, 'de'),
    'risk-asc': (a, b) => a.risks.combined.score - b.risks.combined.score,
    'risk-desc': (a, b) => b.risks.combined.score - a.risks.combined.score
};

function getSiteListItemMarkup(site) {
    const score = site.risks.combined.score;
    const level = getRiskLevel(score);
    const isSelected = selectedSite && selectedSite.name === site.name;

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
            <span class="site-risk">${score.toFixed(1)}%</span>
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
    const filterFn = SITE_FILTERS[currentFilter];
    if (filterFn) {
        sites = sites.filter(filterFn);
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

    // Close all popups
    markers.forEach(marker => marker.closePopup());

    // Update site list selection
    renderSiteList();
}

function showSiteDetails(site) {
    // Show the right panel
    document.querySelector('.panel-right').style.display = 'flex';
    invalidateMapSize();

    const content = document.getElementById('site-detail-content');

    const level = getRiskLevel(site.risks.combined.score);
    const totalVehicles = (site.vehicles.trucks || 0) + (site.vehicles.vans || 0) + (site.vehicles.forklifts || 0);
    const impactScore = getImpactScore(site);
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
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px;">
                        <i class="fas fa-bolt"></i> Business Impact Score
                    </div>
                    <div style="font-size: 1.4rem; font-weight: 700; color: ${getRiskColor(impactScore)};">
                        ${impactScore.toFixed(1)}
                    </div>
                </div>
                <div style="text-align: right; font-size: 0.7rem; color: var(--text-secondary);">
                    <div>Risiko: ${site.risks.combined.score.toFixed(1)}%</div>
                    <div>× Faktor: ${(siteMetadata.criticality_weights?.[site.criticality] || 1.0).toFixed(1)}x</div>
                </div>
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
        
        <!-- Goods Categories -->
        ${site.goods_categories && site.goods_categories.length > 0 ? `
            <div style="margin-top: 12px;">
                <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">
                    <i class="fas fa-tags"></i> Warenkategorien
                </div>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    ${site.goods_categories.map(cat => `
                        <span style="background: rgba(100,116,139,0.3); color: var(--text-secondary); padding: 3px 8px; border-radius: 4px; font-size: 0.7rem;">${cat}</span>
                    `).join('')}
                </div>
            </div>
        ` : ''}
        
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
            
            <!-- Checklist Preview -->
            <details style="cursor: pointer;">
                <summary style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; outline: none;">
                    <i class="fas fa-clipboard-check"></i> Checkliste (${playbook.checklist.length} Punkte)
                </summary>
                <div style="margin-top: 8px; padding-left: 8px;">
                    ${playbook.checklist.slice(0, 5).map(item => `
                        <div style="display: flex; align-items: center; gap: 6px; padding: 4px 0; font-size: 0.7rem; color: var(--text-secondary);">
                            <i class="far fa-square" style="color: var(--text-muted);"></i>
                            ${item}
                        </div>
                    `).join('')}
                    ${playbook.checklist.length > 5 ? `
                        <div style="font-size: 0.65rem; color: var(--text-muted); padding-top: 4px;">
                            +${playbook.checklist.length - 5} weitere...
                        </div>
                    ` : ''}
                </div>
            </details>
        </div>
    `;
}

// ============================================
// Filter Buttons
// ============================================
function initFilterButtons() {
    const buttons = document.querySelectorAll('.filter-btn');
    buttons.forEach(btn => {
        btn.setAttribute('aria-pressed', btn.classList.contains('active'));
        btn.addEventListener('click', () => {
            buttons.forEach(b => {
                const isActive = b === btn;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-pressed', isActive);
            });
            currentFilter = btn.dataset.filter;
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
    document.getElementById('forecast-view').style.display =
        viewName === 'forecast' ? 'flex' : 'none';
    document.getElementById('history-view').style.display =
        viewName === 'history' ? 'flex' : 'none';

    // Toggle header status indicators
    document.getElementById('forecast-status').style.display =
        viewName === 'forecast' ? 'flex' : 'none';
    document.getElementById('forecast-window').style.display =
        viewName === 'forecast' ? 'flex' : 'none';
    document.getElementById('history-info').style.display =
        viewName === 'history' ? 'flex' : 'none';

    // Initialize history map on first switch
    if (viewName === 'history' && !historyMap) {
        initHistoryView();
    }

    // Invalidate map sizes
    if (viewName === 'forecast' && map) {
        setTimeout(() => map.invalidateSize(), 100);
    }
    if (viewName === 'history' && historyMap) {
        setTimeout(() => historyMap.invalidateSize(), 100);
    }
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
        console.log(`Loaded ${eventsData.fires?.length || 0} fires, ${eventsData.earthquakes?.length || 0} earthquakes`);
    } catch (error) {
        console.warn('Could not load events data:', error);
        eventsData = { fires: [], earthquakes: [] };
    }
}

function initHistoryFilters() {
    // Time range
    document.getElementById('history-time-range').addEventListener('change', applyHistoryFilters);

    // Fire filters
    document.getElementById('show-fires').addEventListener('change', (e) => {
        document.getElementById('fire-filters').style.opacity = e.target.checked ? '1' : '0.5';
        applyHistoryFilters();
    });
    document.getElementById('fire-brightness-min').addEventListener('input', (e) => {
        document.getElementById('fire-brightness-value').textContent = e.target.value + 'K';
        applyHistoryFilters();
    });
    document.getElementById('fire-count-min').addEventListener('input', (e) => {
        document.getElementById('fire-count-value').textContent = e.target.value;
        applyHistoryFilters();
    });
    document.getElementById('fire-high-confidence').addEventListener('change', applyHistoryFilters);

    // Quake filters
    document.getElementById('show-quakes').addEventListener('change', (e) => {
        document.getElementById('quake-filters').style.opacity = e.target.checked ? '1' : '0.5';
        applyHistoryFilters();
    });
    document.getElementById('quake-magnitude-min').addEventListener('input', (e) => {
        document.getElementById('quake-magnitude-value').textContent = parseFloat(e.target.value).toFixed(1);
        applyHistoryFilters();
    });
    document.getElementById('quake-depth-max').addEventListener('input', (e) => {
        document.getElementById('quake-depth-value').textContent = e.target.value + 'km';
        applyHistoryFilters();
    });
}

function applyHistoryFilters() {
    const filters = {
        days: parseInt(document.getElementById('history-time-range').value),
        showFires: document.getElementById('show-fires').checked,
        fireBrightnessMin: parseInt(document.getElementById('fire-brightness-min').value),
        fireCountMin: parseInt(document.getElementById('fire-count-min').value),
        fireHighConfidence: document.getElementById('fire-high-confidence').checked,
        showQuakes: document.getElementById('show-quakes').checked,
        quakeMagnitudeMin: parseFloat(document.getElementById('quake-magnitude-min').value),
        quakeDepthMax: parseInt(document.getElementById('quake-depth-max').value)
    };

    const fireCount = renderFireEvents(filters);
    const quakeCount = renderQuakeEvents(filters);

    // Update total
    document.getElementById('visible-total-count').textContent =
        (fireCount + quakeCount).toLocaleString('de-DE');
}

function renderFireEvents(filters) {
    fireLayer.clearLayers();

    if (!filters.showFires || !eventsData?.fires) {
        document.getElementById('visible-fires-count').textContent = '0';
        return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.days);

    const filteredFires = eventsData.fires.filter(fire => {
        const fireDate = new Date(fire.date);
        if (fireDate < cutoffDate) return false;
        if (fire.brightness < filters.fireBrightnessMin) return false;
        if (fire.count < filters.fireCountMin) return false;
        if (filters.fireHighConfidence && fire.confidence !== 'high') return false;
        return true;
    });

    filteredFires.forEach(fire => {
        // Size based on count (aggregated fires)
        const baseRadius = Math.min(3 + Math.log10(fire.count + 1) * 3, 12);
        const color = fire.brightness >= 400 ? '#ff4500' : '#ffa500';

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

function renderQuakeEvents(filters) {
    quakeLayer.clearLayers();

    if (!filters.showQuakes || !eventsData?.earthquakes) {
        document.getElementById('visible-quakes-count').textContent = '0';
        return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.days);

    const filteredQuakes = eventsData.earthquakes.filter(quake => {
        const quakeDate = new Date(quake.date);
        if (quakeDate < cutoffDate) return false;
        if (quake.magnitude < filters.quakeMagnitudeMin) return false;
        if (quake.depth > filters.quakeDepthMax) return false;
        return true;
    });

    filteredQuakes.forEach(quake => {
        // Size based on magnitude
        const radius = Math.min(4 + quake.magnitude * 1.5, 18);
        const color = quake.magnitude >= 6 ? '#8b0000' :
            quake.magnitude >= 4 ? '#8b5cf6' : '#a78bfa';

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
    const date = new Date(fire.date).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const firstDate = fire.date_first ? new Date(fire.date_first).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    }) : null;

    return `
        <div class="event-popup fire-popup">
            <div class="popup-header">🔥 Feuer-Detektion</div>
            <div class="popup-content">
                <div><strong>Letztes Datum:</strong> ${date}</div>
                ${firstDate && firstDate !== date ? `<div><strong>Erstes Datum:</strong> ${firstDate}</div>` : ''}
                <div><strong>Max. Brightness:</strong> ${fire.brightness.toFixed(1)}K</div>
                <div><strong>Avg. Brightness:</strong> ${fire.brightness_avg?.toFixed(1) || 'N/A'}K</div>
                <div><strong>Detektionen:</strong> ${fire.count}</div>
                ${fire.frp ? `<div><strong>Max. FRP:</strong> ${fire.frp.toFixed(1)} MW</div>` : ''}
                <div><strong>Konfidenz:</strong> ${fire.confidence || 'N/A'}</div>
            </div>
        </div>
    `;
}

function createQuakePopup(quake) {
    const date = new Date(quake.date).toLocaleDateString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    return `
        <div class="event-popup quake-popup">
            <div class="popup-header">🌍 Erdbeben M${quake.magnitude.toFixed(1)}</div>
            <div class="popup-content">
                <div><strong>Datum:</strong> ${date}</div>
                <div><strong>Magnitude:</strong> ${quake.magnitude.toFixed(1)}</div>
                <div><strong>Tiefe:</strong> ${quake.depth.toFixed(1)} km</div>
                <div><strong>Ort:</strong> ${quake.place}</div>
            </div>
        </div>
    `;
}

// ============================================
// Initialize on DOM Ready
// ============================================
document.addEventListener('DOMContentLoaded', init);
