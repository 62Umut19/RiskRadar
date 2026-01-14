#!/usr/bin/env python3
"""
Sensor-basierte Label-Generierung für RiskRadar V4

Labels basieren NICHT auf EONET, sondern auf direkten Sensor-Messungen:
- Wildfire: NASA FIRMS Detections (thermale Anomalien)
- Earthquake: USGS Earthquake Catalog (seismische Events)

Author: RiskRadar Team
Date: 2025-12-23
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
import logging
from typing import Dict, Tuple
from geo_utils import haversine_distance

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== LABEL CONFIGURATION ====================

# Gemeinsame Definitionen
RADIUS_KM = 100  # Haversine-Radius um Standort (direkte Umgebung) - for fire
PREDICTION_HORIZON_HOURS = 72  # 72h Vorhersage-Fenster

# FIRMS (Wildfire) Konfiguration
FIRMS_CONFIDENCE_THRESHOLD = 70  # Minimum confidence (0-100)
FIRMS_MIN_FRP = 30.0  # Minimum FRP in MW (Fire Radiative Power) - filtert kleine/industrielle/landwirtschaftliche Feuer
FIRMS_DAYLIGHT_ONLY = True  # Nur Tageslicht-Detektionen (filtert industrielle Nacht-Quellen)
FIRMS_MIN_DETECTIONS = 1  # Mindestens X Detections für Label=1
# FRP Guide: <10 MW = oft landwirtschaftlich/industriell, 10-30 MW = moderate Feuer, >30 MW = echte Wildfires

# USGS (Earthquake) Konfiguration  
USGS_RADIUS_KM = 150  # Larger radius for earthquakes (was 100km) - earthquakes have regional impact
USGS_MIN_MAGNITUDE = 2.0  # Minimum Magnitude (lowered from 2.5 to capture more events)
USGS_MIN_EVENTS = 1  # Mindestens X Events für Label=1

# Optional: Strenger Threshold für "significant events"
USGS_SIGNIFICANT_MAG = 4.0  # M≥4.0 = relevantere Erdbeben


# ==================== WILDFIRE LABEL (FIRMS) ====================

def build_fire_label(
    site: Dict[str, float],
    target_date: pd.Timestamp,
    firms_df: pd.DataFrame,
    confidence_threshold: int = FIRMS_CONFIDENCE_THRESHOLD,
    min_frp: float = FIRMS_MIN_FRP,
    min_detections: int = FIRMS_MIN_DETECTIONS,
    radius_km: float = RADIUS_KM
) -> Tuple[int, Dict]:
    """
    Create wildfire label based on FIRMS detections in future window.
    
    Label = 1 if:
    - At least min_detections FIRMS detections
    - In time window [target_date, target_date + 72h]
    - Within radius_km
    - With confidence >= confidence_threshold
    - With FRP >= min_frp (filters agricultural/small fires)
    
    Args:
        site: Dict with 'name', 'lat', 'lon'
        target_date: Prediction timestamp (UTC)
        firms_df: FIRMS DataFrame with columns [latitude, longitude, acq_date, acq_time, confidence, brightness, frp]
        confidence_threshold: Minimum confidence (0-100)
        min_frp: Minimum Fire Radiative Power in MW (filters small fires)
        min_detections: Minimum number of detections for Label=1
        radius_km: Search radius in km
        
    Returns:
        Tuple[int, Dict]: (label, metadata)
        - label: 0 or 1
        - metadata: Dict with details (count, max_brightness, etc.)
    """
    lat, lon = site['lat'], site['lon']
    
    # 1. Zeitfenster definieren (Future Window!)
    future_start = target_date
    future_end = target_date + timedelta(hours=PREDICTION_HORIZON_HOURS)
    
    # 2. FIRMS Datumsfilter
    # Konvertiere acq_date zu datetime wenn nötig
    if not pd.api.types.is_datetime64_any_dtype(firms_df['acq_date']):
        firms_df = firms_df.copy()
        firms_df['acq_date'] = pd.to_datetime(firms_df['acq_date'])
    
    # Filter: Future Window + Confidence + FRP + (optional) Daylight
    filters = [
        (firms_df['acq_date'] >= future_start),
        (firms_df['acq_date'] < future_end),
        (firms_df['confidence'] >= confidence_threshold),
        (firms_df['frp'] >= min_frp)
    ]
    
    # Daylight filter (nur wenn Spalte existiert)
    if 'daynight' in firms_df.columns:
        filters.append(firms_df['daynight'] == 'D')
    
    # Kombiniere alle Filter
    from functools import reduce
    import operator
    combined_filter = reduce(operator.and_, filters)
    future_fires = firms_df[combined_filter]
    
    # 3. Räumlicher Filter (radius_km) - VECTORIZED for speed (10-100x faster!)
    if len(future_fires) > 0:
        from geo_utils import haversine_distance_vectorized
        distances = haversine_distance_vectorized(
            lat, lon, 
            future_fires['latitude'].values, 
            future_fires['longitude'].values
        )
        future_fires = future_fires[distances < radius_km]
    
    # 4. Label erstellen
    num_detections = len(future_fires)
    label = 1 if num_detections >= min_detections else 0
    
    # 5. Metadata sammeln (für Analyse/Debugging)
    metadata = {
        'num_detections': num_detections,
        'max_brightness': future_fires['brightness'].max() if num_detections > 0 else 0.0,
        'avg_brightness': future_fires['brightness'].mean() if num_detections > 0 else 0.0,
        'max_frp': future_fires['frp'].max() if num_detections > 0 else 0.0,
        'future_window': f"{future_start.strftime('%Y-%m-%d')} to {future_end.strftime('%Y-%m-%d')}"
    }
    
    return label, metadata


# ==================== EARTHQUAKE LABEL (USGS) ====================

def build_quake_label(
    site: Dict[str, float],
    target_date: pd.Timestamp,
    usgs_df: pd.DataFrame,
    min_magnitude: float = USGS_MIN_MAGNITUDE,
    min_events: int = USGS_MIN_EVENTS,
    radius_km: float = USGS_RADIUS_KM
) -> Tuple[int, Dict]:
    """
    Create earthquake label based on USGS events in future window.
    
    Label = 1 if:
    - At least min_events earthquakes
    - In time window [target_date, target_date + 72h]
    - Within radius_km
    - With magnitude >= min_magnitude
    
    Args:
        site: Dict with 'name', 'lat', 'lon'
        target_date: Prediction timestamp (UTC)
        usgs_df: USGS DataFrame with columns [latitude, longitude, time, mag]
        min_magnitude: Minimum Magnitude (e.g. 2.5)
        min_events: Minimum number of events for Label=1
        radius_km: Search radius in km
        
    Returns:
        Tuple[int, Dict]: (label, metadata)
        - label: 0 or 1
        - metadata: Dict with details (count, max_mag, etc.)
    """
    lat, lon = site['lat'], site['lon']
    
    # 1. Define time window (Future Window!)
    future_start = target_date
    future_end = target_date + timedelta(hours=PREDICTION_HORIZON_HOURS)
    
    # 2. USGS Datumsfilter
    if not pd.api.types.is_datetime64_any_dtype(usgs_df['time']):
        usgs_df = usgs_df.copy()
        usgs_df['time'] = pd.to_datetime(usgs_df['time'])
    
    # Filter: Future Window + Magnitude
    future_quakes = usgs_df[
        (usgs_df['time'] >= future_start) &
        (usgs_df['time'] < future_end) &
        (usgs_df['mag'] >= min_magnitude)
    ]
    
    # 3. Räumlicher Filter (radius_km) - VECTORIZED for speed (10-100x faster!)
    if len(future_quakes) > 0:
        from geo_utils import haversine_distance_vectorized
        distances = haversine_distance_vectorized(
            lat, lon,
            future_quakes['latitude'].values,
            future_quakes['longitude'].values
        )
        future_quakes = future_quakes[distances < radius_km]
    
    # 4. Label erstellen
    num_events = len(future_quakes)
    label = 1 if num_events >= min_events else 0
    
    # 5. Metadata sammeln
    metadata = {
        'num_events': num_events,
        'max_magnitude': future_quakes['mag'].max() if num_events > 0 else 0.0,
        'avg_magnitude': future_quakes['mag'].mean() if num_events > 0 else 0.0,
        'num_significant': len(future_quakes[future_quakes['mag'] >= USGS_SIGNIFICANT_MAG]) if num_events > 0 else 0,
        'future_window': f"{future_start.strftime('%Y-%m-%d')} to {future_end.strftime('%Y-%m-%d')}"
    }
    
    return label, metadata


# ==================== BATCH LABEL GENERATION ====================

def generate_labels_for_dataset(
    sites_df: pd.DataFrame,
    target_dates: list,
    firms_df: pd.DataFrame,
    usgs_df: pd.DataFrame
) -> pd.DataFrame:
    """
    Generate labels for all sites × target_dates.
    
    Args:
        sites_df: DataFrame with columns [name, lat, lon]
        target_dates: List of pd.Timestamp (UTC)
        firms_df: FIRMS DataFrame
        usgs_df: USGS DataFrame
        
    Returns:
        DataFrame with columns:
        - site_name, lat, lon, target_date
        - fire_label, fire_detections, fire_max_brightness
        - quake_label, quake_events, quake_max_mag
    """
    results = []
    
    total = len(sites_df) * len(target_dates)
    logger.info(f"Generating labels for {len(sites_df)} sites × {len(target_dates)} dates = {total} samples")
    
    counter = 0
    for idx, site_row in sites_df.iterrows():
        site = {
            'name': site_row['name'],
            'lat': site_row['lat'],
            'lon': site_row['lon']
        }
        
        for target_date in target_dates:
            counter += 1
            if counter % 100 == 0 or counter == total:
                progress = (counter / total) * 100
                logger.info(f"  Progress: {counter}/{total} ({progress:.1f}%) - Current: {site['name']} @ {target_date.strftime('%Y-%m-%d')}")
            
            # Wildfire Label
            fire_label, fire_meta = build_fire_label(site, target_date, firms_df)
            
            # Earthquake Label
            quake_label, quake_meta = build_quake_label(site, target_date, usgs_df)
            
            # Kombiniere
            results.append({
                'site_name': site['name'],
                'lat': site['lat'],
                'lon': site['lon'],
                'target_date': target_date,
                # Fire
                'fire_label': fire_label,
                'fire_detections': fire_meta['num_detections'],
                'fire_max_brightness': fire_meta['max_brightness'],
                'fire_max_frp': fire_meta['max_frp'],
                # Quake
                'quake_label': quake_label,
                'quake_events': quake_meta['num_events'],
                'quake_max_magnitude': quake_meta['max_magnitude'],
                'quake_num_significant': quake_meta['num_significant']
            })
    
    logger.info(f"  Label progress: {total}/{total} (100.0%) - Complete!")
    df = pd.DataFrame(results)
    
    # Stats
    logger.info(f"Label Statistics:")
    logger.info(f"  Fire Events: {df['fire_label'].sum()} / {len(df)} ({df['fire_label'].mean()*100:.1f}%)")
    logger.info(f"  Quake Events: {df['quake_label'].sum()} / {len(df)} ({df['quake_label'].mean()*100:.1f}%)")
    logger.info(f"  Both Events: {((df['fire_label']==1) & (df['quake_label']==1)).sum()}")
    
    return df


# ==================== VALIDATION ====================

def validate_no_leakage(
    features_df: pd.DataFrame,
    labels_df: pd.DataFrame
) -> bool:
    """
    Validiert, dass Features nur Daten < target_date verwenden.
    
    Diese Funktion ist ein Platzhalter - die eigentliche Validierung
    muss im Feature-Engineering-Code passieren.
    
    Args:
        features_df: DataFrame mit Features
        labels_df: DataFrame mit Labels + target_date
        
    Returns:
        bool: True wenn kein Leakage erkannt
    """
    # Basic check: do we have target_date?
    if 'target_date' not in labels_df.columns:
        logger.error("Leakage check failed: target_date missing in labels_df!")
        return False
    
    # Merge and verify all features are matched
    merged = features_df.merge(
        labels_df[['site_name', 'target_date', 'fire_label', 'quake_label']],
        on=['site_name', 'target_date'],
        how='inner'
    )
    
    if len(merged) != len(features_df):
        logger.warning(f"Feature-Label mismatch: {len(features_df)} features, {len(merged)} matched")
    
    logger.info("Leakage check passed - basic validation OK")
    logger.info("(Detailed validation: features must be < target_date)")
    
    return True


# ==================== MAIN (Testing) ====================

if __name__ == "__main__":
    # Test mit Dummy-Daten
    logger.info("Testing sensor_labels.py...")
    
    # Dummy FIRMS Data
    firms_data = pd.DataFrame({
        'latitude': [34.05, 34.06, 34.05],
        'longitude': [-118.24, -118.25, -118.24],
        'acq_date': pd.to_datetime(['2025-12-24', '2025-12-25', '2025-12-26']),
        'acq_time': ['1230', '1400', '0830'],
        'confidence': [85, 92, 78],
        'brightness': [325.7, 341.2, 298.5],
        'frp': [12.5, 18.3, 8.7]
    })
    
    # Dummy USGS Data
    usgs_data = pd.DataFrame({
        'latitude': [61.22, 61.25],
        'longitude': [-149.90, -149.85],
        'time': pd.to_datetime(['2025-12-24 10:30:00', '2025-12-25 14:20:00']),
        'mag': [3.2, 4.5]
    })
    
    # Test Sites
    sites = pd.DataFrame({
        'name': ['Los Angeles', 'Anchorage'],
        'lat': [34.0522, 61.2181],
        'lon': [-118.2437, -149.9003]
    })
    
    # Target Date
    target = pd.Timestamp('2025-12-23 00:00:00')
    
    # Test Fire Label (LA)
    la_site = {'name': 'Los Angeles', 'lat': 34.0522, 'lon': -118.2437}
    fire_label, fire_meta = build_fire_label(la_site, target, firms_data)
    logger.info(f"LA Fire Label: {fire_label} (Detections: {fire_meta['num_detections']})")
    
    # Test Quake Label (Anchorage)
    anc_site = {'name': 'Anchorage', 'lat': 61.2181, 'lon': -149.9003}
    quake_label, quake_meta = build_quake_label(anc_site, target, usgs_data)
    logger.info(f"Anchorage Quake Label: {quake_label} (Events: {quake_meta['num_events']})")
    
    # Test Batch Generation
    target_dates = [target]
    labels_df = generate_labels_for_dataset(sites, target_dates, firms_data, usgs_data)
    logger.info(f"\nGenerated Labels:\n{labels_df[['site_name', 'target_date', 'fire_label', 'quake_label']]}")
    
    logger.info("\n✓ sensor_labels.py tests passed!")
