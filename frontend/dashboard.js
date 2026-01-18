/**
 * RiskRadar Dashboard
 * Loads forecast data from JSON and renders an interactive map
 */

// Configuration
const CONFIG = {
    jsonDataPath: '../outputs/forecast_data.json',
    metadataPath: '../outputs/forecast_metadata.json'
};

// Global state
let map = null;
let markers = [];
let forecastData = null;
let metadata = null;

/**
 * Initialize the dashboard
 */
async function init() {
    try {
        // Load data
        await loadData();

        // Initialize map
        initMap();

        // Render markers
        renderMarkers();

        // Update UI
        updateMetadataUI();
        updateStatsUI();
        renderSiteList();

    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
        document.getElementById('metadata').innerHTML =
            `<span class="error">Error loading data: ${error.message}</span>`;
    }
}

/**
 * Load JSON data files
 */
async function loadData() {
    const [dataResponse, metaResponse] = await Promise.all([
        fetch(CONFIG.jsonDataPath),
        fetch(CONFIG.metadataPath)
    ]);

    if (!dataResponse.ok) {
        throw new Error(`Failed to load forecast data: ${dataResponse.status}`);
    }
    if (!metaResponse.ok) {
        throw new Error(`Failed to load metadata: ${metaResponse.status}`);
    }

    forecastData = await dataResponse.json();
    metadata = await metaResponse.json();
}

/**
 * Initialize Leaflet map
 */
function initMap() {
    map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        zoomControl: true
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
}

/**
 * Get color based on risk score
 */
function getRiskColor(score) {
    if (score >= 75) return 'red';
    if (score >= 50) return 'orange';
    if (score >= 25) return 'cadetblue';
    return 'green';
}

/**
 * Create popup HTML for a site
 */
function createPopupHTML(site) {
    const combinedRisk = site.risks.combined.score;
    const color = getRiskColor(combinedRisk);

    return `
        <div style="font-family: Arial; width: 280px;">
            <h3 style="margin: 0 0 10px 0;">${site.name}</h3>
            <hr>
            
            <div style="margin: 10px 0;">
                <b>🔥 Fire Risk:</b> ${site.risks.fire.score.toFixed(1)}%
                <div style="background: #ffcccc; height: 10px; border-radius: 5px; margin: 5px 0;">
                    <div style="background: #ff0000; height: 10px; width: ${site.risks.fire.score}%; border-radius: 5px;"></div>
                </div>
            </div>
            
            <div style="margin: 10px 0;">
                <b>🌍 Quake Risk:</b> ${site.risks.quake.score.toFixed(1)}%
                <div style="background: #cce5ff; height: 10px; border-radius: 5px; margin: 5px 0;">
                    <div style="background: #0066cc; height: 10px; width: ${site.risks.quake.score}%; border-radius: 5px;"></div>
                </div>
            </div>
            
            <hr>
            
            <div style="margin: 10px 0;">
                <b>⚠️ Combined Risk:</b> ${combinedRisk.toFixed(1)}%
                <div style="background: #e0e0e0; height: 15px; border-radius: 5px; margin: 5px 0;">
                    <div style="background: ${color}; height: 15px; width: ${combinedRisk}%; border-radius: 5px;"></div>
                </div>
                <span style="color: ${color}; font-weight: bold;">${site.risk_level}</span>
            </div>
            
            <hr>
            <small>Forecast window: ${forecastData.forecast_window_hours}h</small>
        </div>
    `;
}

/**
 * Render markers on map
 */
function renderMarkers() {
    // Clear existing markers
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    forecastData.sites.forEach(site => {
        const color = getRiskColor(site.risks.combined.score);

        const marker = L.circleMarker([site.lat, site.lon], {
            radius: 10,
            color: color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 2
        });

        marker.bindPopup(createPopupHTML(site), { maxWidth: 300 });
        marker.bindTooltip(`${site.name}: ${site.risks.combined.score.toFixed(1)}%`, { sticky: true });

        marker.addTo(map);
        markers.push(marker);
    });

    // Fit bounds to show all markers if we have sites
    if (forecastData.sites.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

/**
 * Update metadata in UI
 */
function updateMetadataUI() {
    const date = new Date(forecastData.generated_at);
    document.getElementById('generated-at').textContent =
        `Generated: ${date.toLocaleString()}`;
    document.getElementById('site-count').textContent =
        `| ${forecastData.sites.length} Sites`;
}

/**
 * Update statistics in UI
 */
function updateStatsUI() {
    if (metadata && metadata.statistics) {
        document.getElementById('avg-fire').textContent =
            `${metadata.statistics.avg_fire_risk.toFixed(1)}%`;
        document.getElementById('avg-quake').textContent =
            `${metadata.statistics.avg_quake_risk.toFixed(1)}%`;
        document.getElementById('avg-combined').textContent =
            `${metadata.statistics.avg_combined_risk.toFixed(1)}%`;
    }
}

/**
 * Render site list in sidebar
 */
function renderSiteList() {
    const container = document.getElementById('site-list');

    // Sort by combined risk (highest first)
    const sortedSites = [...forecastData.sites].sort(
        (a, b) => b.risks.combined.score - a.risks.combined.score
    );

    container.innerHTML = sortedSites.map(site => {
        const color = getRiskColor(site.risks.combined.score);
        return `
            <div class="site-item" onclick="focusSite(${site.lat}, ${site.lon})">
                <span class="site-marker" style="background: ${color};"></span>
                <span class="site-name">${site.name}</span>
                <span class="site-risk">${site.risks.combined.score.toFixed(1)}%</span>
            </div>
        `;
    }).join('');
}

/**
 * Focus map on a specific site
 */
function focusSite(lat, lon) {
    map.setView([lat, lon], 8);

    // Find and open the marker popup
    markers.forEach(marker => {
        const latlng = marker.getLatLng();
        if (latlng.lat === lat && latlng.lng === lon) {
            marker.openPopup();
        }
    });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
