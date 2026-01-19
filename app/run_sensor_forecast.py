#!/usr/bin/env python3
"""
Sensor-based Real Forecast for RiskRadar V4

Generates Dual-Risk Predictions:
- Fire Risk Score (0-100)
- Quake Risk Score (0-100)

Uses sensor-based models instead of EONET-based.

Author: RiskRadar Team
Date: 2025-12-23
"""

import pandas as pd
import numpy as np
from pathlib import Path
import logging
from datetime import datetime, timezone
import joblib
import folium
from folium import plugins

# Local imports
from sensor_features import extract_all_features
from firms_client import FIRMSClient
from usgs_client import USGSClient
from config import Config

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== CONFIGURATION ====================

OUTPUT_DIR = Path(Config.OUTPUT_DIR)
DATA_DIR = Path(Config.DATA_DIR)
SITES_CSV = DATA_DIR / 'standorte.csv'

# Model Paths
FIRE_MODEL_PATH = OUTPUT_DIR / 'fire_model_v4.pkl'
QUAKE_MODEL_PATH = OUTPUT_DIR / 'quake_model_v4.pkl'


# ==================== LOAD MODELS ====================

def load_models():
    """
    Load both models.
    
    Returns:
        (fire_model, quake_model, fire_features, quake_features)
    """
    logger.info("Loading models...")
    
    if not FIRE_MODEL_PATH.exists():
        raise FileNotFoundError(f"Fire model not found: {FIRE_MODEL_PATH}")
    if not QUAKE_MODEL_PATH.exists():
        raise FileNotFoundError(f"Quake model not found: {QUAKE_MODEL_PATH}")
    
    fire_model = joblib.load(FIRE_MODEL_PATH)
    quake_model = joblib.load(QUAKE_MODEL_PATH)
    
    logger.info(f"  ✓ Fire Model loaded: {FIRE_MODEL_PATH}")
    logger.info(f"  ✓ Quake Model loaded: {QUAKE_MODEL_PATH}")
    
    # Load feature names from metadata
    import json
    fire_meta_path = OUTPUT_DIR / 'fire_model_metadata_v4.json'
    quake_meta_path = OUTPUT_DIR / 'quake_model_metadata_v4.json'
    
    with open(fire_meta_path) as f:
        fire_meta = json.load(f)
        fire_features = fire_meta['feature_names']
    
    with open(quake_meta_path) as f:
        quake_meta = json.load(f)
        quake_features = quake_meta['feature_names']
    
    return fire_model, quake_model, fire_features, quake_features


# ==================== DATA LOADING ====================

def load_sites():
    """Load sites from CSV."""
    logger.info(f"Loading sites from {SITES_CSV}...")
    df = pd.read_csv(SITES_CSV)
    logger.info(f"  Loaded {len(df)} sites")
    return df


def fetch_sensor_data():
    """
    Fetch current sensor data (FIRMS + USGS).
    
    Returns:
        (firms_df, usgs_df)
    """
    logger.info("\nFetching sensor data...")
    
    # FIRMS
    logger.info("  Fetching FIRMS data...")
    firms_client = FIRMSClient()
    
    # Try cache, otherwise API
    firms_csv = Path('FIRMS_2025_NRT/fire_nrt_M-C61_699365.csv')  # Most recent NRT data
    if firms_csv.exists():
        logger.info(f"    Using cached FIRMS: {firms_csv}")
        firms_df = pd.read_csv(firms_csv)
        firms_df['acq_date'] = pd.to_datetime(firms_df['acq_date']).dt.tz_localize('UTC')
    else:
        logger.info("    No cache found, using API...")
        # Hier würdest du API fetchen
        firms_df = pd.DataFrame({
            'latitude': [],
            'longitude': [],
            'acq_date': pd.to_datetime([]),
            'confidence': [],
            'brightness': [],
            'frp': []
        })
        firms_df['acq_date'] = firms_df['acq_date'].dt.tz_localize('UTC')
    
    logger.info(f"    ✓ Loaded {len(firms_df):,} FIRMS detections")
    
    # USGS
    logger.info("  Fetching USGS data...")
    usgs_cache = OUTPUT_DIR / 'usgs_earthquakes_cache.csv'
    if usgs_cache.exists():
        logger.info(f"    Using cached USGS: {usgs_cache}")
        usgs_df = pd.read_csv(usgs_cache)
        usgs_df['time'] = pd.to_datetime(usgs_df['time'], format='ISO8601').dt.tz_localize('UTC')
    else:
        logger.info("    No cache found, using API...")
        usgs_client = USGSClient()
        # Hier würdest du API fetchen
        usgs_df = pd.DataFrame({
            'latitude': [],
            'longitude': [],
            'time': pd.to_datetime([]),
            'mag': []
        })
        usgs_df['time'] = usgs_df['time'].dt.tz_localize('UTC')
    
    logger.info(f"    ✓ Loaded {len(usgs_df):,} earthquakes")
    
    return firms_df, usgs_df


# ==================== PREDICTION ====================

def predict_dual_risk(
    site: dict,
    target_date: pd.Timestamp,
    firms_df: pd.DataFrame,
    usgs_df: pd.DataFrame,
    fire_model,
    quake_model,
    fire_features: list,
    quake_features: list,
    weather_api_key: str = None
) -> dict:
    """
    Prediction for one site.
    
    Args:
        site: {'name', 'lat', 'lon'}
        target_date: Date for prediction
        firms_df, usgs_df: Sensor Data
        fire_model, quake_model: Models
        weather_api_key: Optional
        
    Returns:
        {
            'site_name': str,
            'fire_risk_score': float (0-100),
            'quake_risk_score': float (0-100),
            'combined_risk_score': float (0-100),
            'fire_probability': float (0-1),
            'quake_probability': float (0-1)
        }
    """
    # Fire Features + Prediction (using FORECAST weather!)
    fire_features_dict = extract_all_features(
        site=site,
        target_date=target_date,
        firms_df=firms_df,
        usgs_df=usgs_df,
        weather_api_key=weather_api_key,
        model_type='fire',
        use_historical_weather=False  # Forecast for predictions!
    )
    
    # Feature order must match training!
    fire_feature_vector = np.array([fire_features_dict[fname] for fname in fire_features])
    fire_proba = fire_model.predict_proba([fire_feature_vector])[0][1]
    
    # Quake Features + Prediction
    quake_features_dict = extract_all_features(
        site=site,
        target_date=target_date,
        firms_df=firms_df,
        usgs_df=usgs_df,
        weather_api_key=weather_api_key,
        model_type='quake',
        use_historical_weather=False  # Forecast for Predictions!
    )
    
    quake_feature_vector = np.array([quake_features_dict[fname] for fname in quake_features])
    quake_proba = quake_model.predict_proba([quake_feature_vector])[0][1]
    
    # ==================== PHYSICS-BASED ADJUSTMENTS ====================
    # Reduce Fire Risk in cold temperatures (snow, frost)
    temp_mean = fire_features_dict.get('temp_mean', 15.0)  # Default 15°C
    humidity_mean = fire_features_dict.get('humidity_mean', 60.0)
    humidity_min = fire_features_dict.get('humidity_min', 50.0)
    
    # STRONGER RULES: Frost/High Humidity makes fire nearly impossible
    if temp_mean <= 0 and humidity_mean > 70:  # Frost + Moist = Nearly impossible
        fire_proba *= 0.01  # 99% Reduction
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C ≤ 0°C + humidity={humidity_mean:.1f}% > 70% → Fire Risk reduced by 99%")
    elif temp_mean <= 0:  # At/Below 0°C: Frost/Snow
        fire_proba *= 0.05  # 95% Reduction
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C ≤ 0°C → Fire Risk reduced by 95%")
    elif temp_mean < 5:  # 0-5°C: Very cold
        fire_proba *= 0.2  # 80% Reduction
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C < 5°C → Fire Risk reduced by 80%")
    elif temp_mean < 10:  # 5-10°C: Kalt
        fire_proba *= 0.5  # 50% Reduction
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C < 10°C → Fire Risk reduced by 50%")
    
    # MODERATE TEMPS: Dampen in moderate conditions without extreme heat/dryness
    # Only if NOT very dry at the same time (then historical activity could be justified)
    elif 10 <= temp_mean < 25 and humidity_min > 40:  # Moderate + Not extremely dry
        fire_proba *= 0.85  # 15% Reduction (gentle)
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C (moderate) + humidity_min={humidity_min:.1f}% > 40% → Fire Risk reduced by 15%")
    
    # Increase Fire Risk in extreme heat + low humidity
    humidity_min = fire_features_dict.get('humidity_min', 50.0)
    
    if temp_mean > 35 and humidity_min < 20:  # Extremely hot + dry
        fire_proba *= 1.5  # 50% Increase (max 1.0)
        fire_proba = min(fire_proba, 1.0)
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C > 35°C AND humidity_min={humidity_min:.1f}% < 20% → Fire Risk increased by 50%")
    elif temp_mean > 30 and humidity_min < 30:  # Very hot + dry
        fire_proba *= 1.3  # 30% Increase
        fire_proba = min(fire_proba, 1.0)
        logger.debug(f"    Physics Rule: temp_mean={temp_mean:.1f}°C > 30°C AND humidity_min={humidity_min:.1f}% < 30% → Fire Risk increased by 30%")
    
    # Combined Risk (1 - P(kein Event))
    combined_proba = 1 - (1 - fire_proba) * (1 - quake_proba)
    
    return {
        'site_name': site['name'],
        'lat': site['lat'],
        'lon': site['lon'],
        'fire_probability': fire_proba,
        'fire_risk_score': fire_proba * 100,
        'quake_probability': quake_proba,
        'quake_risk_score': quake_proba * 100,
        'combined_probability': combined_proba,
        'combined_risk_score': combined_proba * 100
    }


# ==================== VISUALIZATION ====================

def create_dual_risk_map(predictions_df: pd.DataFrame, output_path: Path):
    """
    Create interactive map with dual-risk visualization.
    
    Args:
        predictions_df: DataFrame with predictions
        output_path: Path for HTML output
    """
    logger.info("\nCreating interactive map...")
    
    # Base map
    m = folium.Map(
        location=[20, 0],  # Welt-Zentrum
        zoom_start=2,
        tiles='OpenStreetMap'
    )
    
    # Marker for each site
    for idx, row in predictions_df.iterrows():
        
        # Color based on Combined Risk
        combined_risk = row['combined_risk_score']
        if combined_risk >= 75:
            color = 'red'
            risk_label = 'Very High'
        elif combined_risk >= 50:
            color = 'orange'
            risk_label = 'High'
        elif combined_risk >= 25:
            color = 'yellow'
            risk_label = 'Medium'
        else:
            color = 'green'
            risk_label = 'Low'
        
        # Popup with details
        popup_html = f"""
        <div style="font-family: Arial; width: 300px;">
            <h3 style="margin: 0 0 10px 0;">{row['site_name']}</h3>
            <hr>
            
            <div style="margin: 10px 0;">
                <b>🔥 Fire Risk:</b> {row['fire_risk_score']:.1f}% 
                <div style="background: #ffcccc; height: 10px; border-radius: 5px; margin: 5px 0;">
                    <div style="background: #ff0000; height: 10px; width: {row['fire_risk_score']}%; border-radius: 5px;"></div>
                </div>
            </div>
            
            <div style="margin: 10px 0;">
                <b>🌍 Quake Risk:</b> {row['quake_risk_score']:.1f}%
                <div style="background: #cce5ff; height: 10px; border-radius: 5px; margin: 5px 0;">
                    <div style="background: #0066cc; height: 10px; width: {row['quake_risk_score']}%; border-radius: 5px;"></div>
                </div>
            </div>
            
            <hr>
            
            <div style="margin: 10px 0;">
                <b>⚠️ Combined Risk:</b> {row['combined_risk_score']:.1f}%
                <div style="background: #e0e0e0; height: 15px; border-radius: 5px; margin: 5px 0;">
                    <div style="background: {color}; height: 15px; width: {row['combined_risk_score']}%; border-radius: 5px;"></div>
                </div>
                <span style="color: {color}; font-weight: bold;">{risk_label}</span>
            </div>
            
            <hr>
            <small>Vorhersage für nächste 72h</small>
        </div>
        """
        
        folium.CircleMarker(
            location=[row['lat'], row['lon']],
            radius=10,
            popup=folium.Popup(popup_html, max_width=300),
            tooltip=f"{row['site_name']}: {combined_risk:.1f}%",
            color=color,
            fillColor=color,
            fillOpacity=0.7,
            weight=2
        ).add_to(m)
    
    # Legend
    legend_html = """
    <div style="position: fixed; 
                bottom: 50px; right: 50px; width: 200px; 
                background: white; border: 2px solid grey; z-index: 9999; 
                padding: 10px; font-size: 14px;">
        <h4 style="margin: 0 0 10px 0;">Risk Level</h4>
        <p><span style="color: red;">●</span> Very High (≥75%)</p>
        <p><span style="color: orange;">●</span> High (50-75%)</p>
        <p><span style="color: yellow;">●</span> Medium (25-50%)</p>
        <p><span style="color: green;">●</span> Low (<25%)</p>
        <hr>
        <small>🔥 Fire | 🌍 Quake | ⚠️ Combined</small>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))
    
    # Fullscreen Option
    plugins.Fullscreen().add_to(m)
    
    # Speichern
    m.save(str(output_path))
    logger.info(f"  ✓ Map saved: {output_path}")


# ==================== MAIN ====================

def main():
    """Main Prediction Pipeline."""
    
    logger.info("="*80)
    logger.info("RISKRADAR V4 - SENSOR-BASED DUAL-RISK FORECAST")
    logger.info("="*80)
    
    # Target Date: NOW
    target_date = pd.Timestamp.now(tz=timezone.utc)
    logger.info(f"\nTarget Date: {target_date.strftime('%Y-%m-%d %H:%M UTC')}")
    logger.info(f"Prediction Window: Next 72 hours")
    
    # 1. Load Models
    logger.info("\n1. Loading Models...")
    fire_model, quake_model, fire_features, quake_features = load_models()
    
    # 2. Load Sites
    logger.info("\n2. Loading Sites...")
    sites_df = load_sites()
    
    # 3. Fetch Sensor Data
    logger.info("\n3. Fetching Sensor Data...")
    firms_df, usgs_df = fetch_sensor_data()
    
    # 4. Generate Predictions
    logger.info("\n4. Generating Predictions...")
    predictions = []
    
    for idx, row in sites_df.iterrows():
        site = {
            'name': row['name'],
            'lat': row['lat'],
            'lon': row['lon']
        }
        
        logger.info(f"  Predicting for {site['name']}...")
        
        pred = predict_dual_risk(
            site=site,
            target_date=target_date,
            firms_df=firms_df,
            usgs_df=usgs_df,
            fire_model=fire_model,
            quake_model=quake_model,
            fire_features=fire_features,
            quake_features=quake_features,
            weather_api_key=Config.OPENWEATHER_API_KEY
        )
        
        predictions.append(pred)
    
    # DataFrame
    predictions_df = pd.DataFrame(predictions)
    
    # Sort by Combined Risk
    predictions_df = predictions_df.sort_values('combined_risk_score', ascending=False)
    
    # 5. Save Results
    logger.info("\n5. Saving Results...")
    
    # CSV
    csv_path = OUTPUT_DIR / 'sensor_forecast_72h.csv'
    predictions_df.to_csv(csv_path, index=False)
    logger.info(f"  ✓ CSV saved: {csv_path}")
    
    # HTML Map
    map_path = OUTPUT_DIR / 'sensor_forecast_map.html'
    create_dual_risk_map(predictions_df, map_path)
    
    # 6. Summary
    logger.info("\n" + "="*80)
    logger.info("PREDICTION SUMMARY")
    logger.info("="*80)
    
    logger.info(f"\nTop 5 High-Risk Locations (Combined Risk):\n")
    for idx, row in predictions_df.head(5).iterrows():
        logger.info(f"  {row['site_name']:20s}  Combined: {row['combined_risk_score']:5.1f}%  "
                    f"(Fire: {row['fire_risk_score']:5.1f}%, Quake: {row['quake_risk_score']:5.1f}%)")
    
    logger.info(f"\n\nAverage Risks:")
    logger.info(f"  Fire Risk:     {predictions_df['fire_risk_score'].mean():.1f}%")
    logger.info(f"  Quake Risk:    {predictions_df['quake_risk_score'].mean():.1f}%")
    logger.info(f"  Combined Risk: {predictions_df['combined_risk_score'].mean():.1f}%")
    
    # Done
    logger.info("\n" + "="*80)
    logger.info("✓ FORECAST COMPLETE!")
    logger.info("="*80)
    logger.info(f"\nOutputs:")
    logger.info(f"  - CSV:  {csv_path}")
    logger.info(f"  - Map:  {map_path}")
    logger.info(f"\nOpen map in browser to explore results!")


if __name__ == "__main__":
    import sys
    try:
        main()
    except Exception as e:
        logger.error(f"\nERROR: {e}", exc_info=True)
        sys.exit(1)
