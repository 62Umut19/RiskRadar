#!/usr/bin/env python3
"""
Event Data Exporter for RiskRadar History View

Exports FIRMS fire detections and USGS earthquakes from the last 90 days
to a JSON file for the frontend History View.

All events are exported - filtering is done in the UI.

Author: RiskRadar Team
Date: 2026-01-25
"""

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List

import pandas as pd

from config import Config
from firms_client import FIRMSClient
from usgs_client import USGSClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLDS = {
    "nominal": 30,
    "high": 80
}
CONFIDENCE_LABELS = {
    0: "low",
    1: "nominal",
    2: "high"
}


def _confidence_rank(value) -> int:
    if value is None or pd.isna(value):
        return 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"high", "h"}:
            return 2
        if normalized in {"nominal", "n"}:
            return 1
        if normalized in {"low", "l"}:
            return 0
        try:
            value = float(normalized)
        except ValueError:
            return 0
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0
    if score >= CONFIDENCE_THRESHOLDS["high"]:
        return 2
    if score >= CONFIDENCE_THRESHOLDS["nominal"]:
        return 1
    return 0


def _format_date(value) -> str:
    if value is None or pd.isna(value):
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def export_fire_events(firms_client: FIRMSClient, days: int = 90) -> List[Dict]:
    """
    Export fire detections from the last N days with spatial aggregation.
    
    Aggregates fires to 0.1° grid cells to reduce data volume while
    preserving key statistics (max brightness, count, date range).
    
    Args:
        firms_client: FIRMS client instance
        days: Number of days to look back
    
    Returns:
        List of aggregated fire event dictionaries
    """
    logger.info(f"Exporting fire events from the last {days} days...")
    
    if firms_client._data is None or len(firms_client._data) == 0:
        logger.warning("No FIRMS data available")
        return []
    
    # Filter by date (compare by day to avoid timezone edge cases)
    cutoff_date = (datetime.utcnow() - timedelta(days=days)).date()
    recent_fires = firms_client._data[
        firms_client._data['acq_date'].dt.date >= cutoff_date
    ].copy()
    
    logger.info(f"Found {len(recent_fires):,} fire detections in date range")
    
    if len(recent_fires) == 0:
        return []
    
    # Spatial aggregation: Round to 0.1 degree grid
    recent_fires['grid_lat'] = (recent_fires['latitude'] * 10).round() / 10
    recent_fires['grid_lon'] = (recent_fires['longitude'] * 10).round() / 10
    
    recent_fires['confidence_rank'] = recent_fires['confidence'].apply(_confidence_rank)

    # Aggregate by grid cell
    aggregated = recent_fires.groupby(['grid_lat', 'grid_lon']).agg({
        'brightness': ['max', 'mean', 'count'],
        'frp': 'max',
        'acq_date': ['min', 'max'],
        'confidence_rank': 'max'
    }).reset_index()

    # Flatten column names
    aggregated.columns = ['lat', 'lon', 'brightness_max', 'brightness_avg', 'count',
                          'frp_max', 'date_first', 'date_last', 'confidence_rank']
    aggregated['confidence'] = aggregated['confidence_rank'].map(CONFIDENCE_LABELS)
    
    logger.info(f"Aggregated to {len(aggregated):,} grid cells")
    
    # Convert to list of dicts
    fires = []
    for _, row in aggregated.iterrows():
        fire = {
            'lat': round(float(row['lat']), 1),
            'lon': round(float(row['lon']), 1),
            'date': _format_date(row['date_last']),
            'date_first': _format_date(row['date_first']),
            'brightness': round(float(row['brightness_max']), 1),
            'brightness_avg': round(float(row['brightness_avg']), 1),
            'frp': round(float(row['frp_max']), 1) if pd.notna(row['frp_max']) else None,
            'count': int(row['count']),
            'confidence': str(row['confidence'])
        }
        fires.append(fire)
    
    logger.info(f"Exported {len(fires):,} aggregated fire events")
    return fires


def export_earthquake_events(usgs_client: USGSClient, days: int = 90, min_magnitude: float = 2.5) -> List[Dict]:
    """
    Export all earthquakes from the last N days.
    
    Args:
        usgs_client: USGS client instance
        days: Number of days to look back
        min_magnitude: Minimum magnitude to include
    
    Returns:
        List of earthquake event dictionaries
    """
    logger.info(f"Exporting earthquake events from the last {days} days (min mag {min_magnitude})...")
    
    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)
    
    # Fetch global earthquakes
    quakes_raw = usgs_client.get_global_earthquakes(
        start_date=start_date.strftime('%Y-%m-%d'),
        end_date=end_date.strftime('%Y-%m-%d'),
        min_magnitude=min_magnitude
    )
    
    if not quakes_raw:
        logger.warning("No earthquake data returned from USGS")
        return []
    
    # Convert to our format
    earthquakes = []
    for quake in quakes_raw:
        earthquake = {
            'lat': round(float(quake.get('latitude', 0)), 4),
            'lon': round(float(quake.get('longitude', 0)), 4),
            'date': quake.get('time', ''),
            'magnitude': round(float(quake.get('mag', 0)), 1),
            'depth': round(float(quake.get('depth_km', 0)), 1),
            'place': quake.get('place', 'Unknown'),
            'type': quake.get('type', 'earthquake')
        }
        earthquakes.append(earthquake)
    
    logger.info(f"Exported {len(earthquakes):,} earthquake events")
    return earthquakes


def main():
    """Main export pipeline."""
    print("=" * 70)
    print("RISKRADAR EVENT DATA EXPORTER")
    print("=" * 70)
    print(f"\nExporting last {Config.EVENT_HISTORY_DAYS} days of events")
    print(f"Output: {Config.EVENTS_OUTPUT_FILE}\n")
    
    # Ensure output directory exists
    Path(Config.FRONTEND_DATA_DIR).mkdir(parents=True, exist_ok=True)
    
    # Initialize clients
    print("Initializing data clients...")
    firms_client = FIRMSClient()
    usgs_client = USGSClient()
    
    # Export fire events
    print("\n" + "-" * 40)
    fires = export_fire_events(
        firms_client, 
        days=Config.EVENT_HISTORY_DAYS
    )
    
    # Export earthquake events
    print("\n" + "-" * 40)
    earthquakes = export_earthquake_events(
        usgs_client,
        days=Config.EVENT_HISTORY_DAYS,
        min_magnitude=Config.MIN_EARTHQUAKE_MAGNITUDE_EXPORT
    )
    
    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=Config.EVENT_HISTORY_DAYS)
    
    # Build output structure
    output = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "data_range": {
            "start": start_date.strftime('%Y-%m-%d'),
            "end": end_date.strftime('%Y-%m-%d'),
            "days": Config.EVENT_HISTORY_DAYS
        },
        "statistics": {
            "total_fires": len(fires),
            "total_earthquakes": len(earthquakes),
            "fire_brightness_range": {
                "min": min((f['brightness'] for f in fires), default=0),
                "max": max((f['brightness'] for f in fires), default=0)
            } if fires else {"min": 0, "max": 0},
            "earthquake_magnitude_range": {
                "min": min((q['magnitude'] for q in earthquakes), default=0),
                "max": max((q['magnitude'] for q in earthquakes), default=0)
            } if earthquakes else {"min": 0, "max": 0}
        },
        "fires": fires,
        "earthquakes": earthquakes
    }
    
    # Write to file
    print("\n" + "-" * 40)
    print(f"Writing to {Config.EVENTS_OUTPUT_FILE}...")
    
    with open(Config.EVENTS_OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    file_size = Path(Config.EVENTS_OUTPUT_FILE).stat().st_size / (1024 * 1024)
    
    print("\n" + "=" * 70)
    print("EXPORT COMPLETE")
    print("=" * 70)
    print(f"\n📊 Statistics:")
    print(f"   🔥 Fire events: {len(fires):,}")
    print(f"   🌍 Earthquake events: {len(earthquakes):,}")
    print(f"   📅 Date range: {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
    print(f"   💾 File size: {file_size:.2f} MB")
    print(f"\n✅ Output saved to: {Config.EVENTS_OUTPUT_FILE}")


if __name__ == "__main__":
    main()
