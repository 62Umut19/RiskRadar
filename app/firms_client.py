"""
NASA FIRMS (Fire Information for Resource Management System) Client

Provides access to active fire data from MODIS and VIIRS satellites.
Uses local CSV files downloaded from FIRMS instead of API (no rate limits!).

Data source: https://firms.modaps.eosdis.nasa.gov/download/
"""

import pandas as pd
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import numpy as np
from config import Config

logger = logging.getLogger(__name__)


class FIRMSClient:
    """
    Client for NASA FIRMS active fire detection using local CSV files.
    
    FIRMS provides near real-time active fire data from MODIS and VIIRS satellites.
    This version loads from downloaded CSV files instead of API.
    """
    
    def __init__(self, data_dir: Optional[str] = None):
        """
        Initialize FIRMS client with local CSV files.
        
        Args:
            data_dir: Directory containing FIRMS CSV files
                     Default: ../FIRMS_2024_ARCHIVE/ and ../FIRMS_2025_NRT/
        """
        # Use centralized paths from Config
        self.archive_2024_file = Path(Config.FIRMS_ARCHIVE_2024_FILE)
        self.archive_2025_file = Path(Config.FIRMS_ARCHIVE_2025_FILE)
        self.nrt_2025_file = Path(Config.FIRMS_NRT_2025_FILE)
        
        # Cache loaded data
        self._data = None
        self._load_data()
    
    def _load_data(self):
        """Load FIRMS CSV files into memory (cached)."""
        if self._data is not None:
            return
        
        logger.info("Loading FIRMS data from multiple sources...")
        logger.info("=" * 70)
        
        dfs = []
        
        # Load 2024 archive data
        if self.archive_2024_file.exists():
            logger.info(f"Loading FIRMS data from {self.archive_2024_file}...")
            try:
                df_2024 = pd.read_csv(self.archive_2024_file)
                df_2024['acq_date'] = pd.to_datetime(df_2024['acq_date'])
                dfs.append(df_2024)
                logger.info(f"  Loaded {len(df_2024):,} FIRMS detections")
                logger.info(f"  Date range: {df_2024['acq_date'].min()} to {df_2024['acq_date'].max()}")
                logger.info(f"  2024 Archive: {len(df_2024):,} detections")
            except Exception as e:
                logger.warning(f"Failed to load 2024 archive: {e}")
        
        # Load 2025 archive data
        if self.archive_2025_file.exists():
            logger.info(f"Loading FIRMS data from {self.archive_2025_file}...")
            try:
                df_2025_archive = pd.read_csv(self.archive_2025_file)
                df_2025_archive['acq_date'] = pd.to_datetime(df_2025_archive['acq_date'])
                dfs.append(df_2025_archive)
                logger.info(f"  Loaded {len(df_2025_archive):,} FIRMS detections")
                logger.info(f"  Date range: {df_2025_archive['acq_date'].min()} to {df_2025_archive['acq_date'].max()}")
                logger.info(f"  2025 Archive: {len(df_2025_archive):,} detections")
            except Exception as e:
                logger.warning(f"Failed to load 2025 archive: {e}")
        
        # Load 2025 NRT data
        if self.nrt_2025_file.exists():
            logger.info(f"Loading FIRMS data from {self.nrt_2025_file}...")
            try:
                df_2025_nrt = pd.read_csv(self.nrt_2025_file)
                df_2025_nrt['acq_date'] = pd.to_datetime(df_2025_nrt['acq_date'])
                dfs.append(df_2025_nrt)
                logger.info(f"  Loaded {len(df_2025_nrt):,} FIRMS detections")
                logger.info(f"  Date range: {df_2025_nrt['acq_date'].min()} to {df_2025_nrt['acq_date'].max()}")
                logger.info(f"  2025 NRT: {len(df_2025_nrt):,} detections")
            except Exception as e:
                logger.warning(f"Failed to load 2025 NRT: {e}")
        
        if not dfs:
            logger.error("No FIRMS data files found!")
            self._data = pd.DataFrame()
            return
        
        # Combine all data
        self._data = pd.concat(dfs, ignore_index=True)
        
        # Remove duplicates (in case there's overlap between files)
        initial_count = len(self._data)
        self._data = self._data.drop_duplicates(
            subset=['latitude', 'longitude', 'acq_date', 'acq_time'],
            keep='last'
        )
        
        logger.info("=" * 70)
        logger.info(f"Combined total: {len(self._data):,} detections")
        logger.info(f"Date range: {self._data['acq_date'].min()} to {self._data['acq_date'].max()}")
        logger.info("=" * 70)
    
    def _haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance in km between two points."""
        from math import radians, sin, cos, sqrt, atan2
        
        R = 6371  # Earth radius in km
        
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        
        return R * c
    
    def get_active_fires(
        self,
        lat: float,
        lon: float,
        radius_km: int = 200,
        days: int = 7
    ) -> Dict:
        """
        Get active fire detections within radius of a location.
        
        Args:
            lat: Latitude of center point
            lon: Longitude of center point
            radius_km: Search radius in kilometers
            days: Number of days to look back
        
        Returns:
            Dictionary with fire data:
            {
                'count': int,
                'fires': List[Dict],
                'max_brightness': float,
                'avg_brightness': float,
                'persistent_fires': int
            }
        """
        if self._data is None or len(self._data) == 0:
            return {
                'count': 0,
                'fires': [],
                'max_brightness': 0.0,
                'avg_brightness': 0.0,
                'persistent_fires': 0
            }
        
        # Filter by date
        cutoff_date = datetime.now() - timedelta(days=days)
        recent_fires = self._data[self._data['acq_date'] >= cutoff_date].copy()
        
        if len(recent_fires) == 0:
            return {
                'count': 0,
                'fires': [],
                'max_brightness': 0.0,
                'avg_brightness': 0.0,
                'persistent_fires': 0
            }
        
        # Calculate distances
        recent_fires['distance_km'] = recent_fires.apply(
            lambda row: self._haversine_distance(lat, lon, row['latitude'], row['longitude']),
            axis=1
        )
        
        # Filter by radius
        nearby_fires = recent_fires[recent_fires['distance_km'] <= radius_km]
        
        count = len(nearby_fires)
        
        if count == 0:
            return {
                'count': 0,
                'fires': [],
                'max_brightness': 0.0,
                'avg_brightness': 0.0,
                'persistent_fires': 0
            }
        
        # Calculate statistics
        brightnesses = nearby_fires['brightness'].dropna()
        max_brightness = float(brightnesses.max()) if len(brightnesses) > 0 else 0.0
        avg_brightness = float(brightnesses.mean()) if len(brightnesses) > 0 else 0.0
        
        # Count persistent fires (same location, different days)
        locations = {}
        for _, fire in nearby_fires.iterrows():
            lat_key = round(fire['latitude'], 2)
            lon_key = round(fire['longitude'], 2)
            key = (lat_key, lon_key)
            
            date = fire['acq_date'].date()
            if key not in locations:
                locations[key] = set()
            locations[key].add(date)
        
        persistent_fires = sum(1 for dates in locations.values() if len(dates) > 1)
        
        # Convert to list of dicts
        fires_list = nearby_fires.head(100).to_dict('records')  # Limit to 100 for memory
        
        result = {
            'count': count,
            'fires': fires_list,
            'max_brightness': max_brightness,
            'avg_brightness': avg_brightness,
            'persistent_fires': persistent_fires
        }
        
        logger.debug(
            f"FIRMS: {count} fires near ({lat:.2f}, {lon:.2f}), "
            f"max brightness: {max_brightness:.1f}K"
        )
        
        return result
    
    def get_fire_features(self, lat: float, lon: float) -> Dict[str, float]:
        """
        Get fire-related features for ML model.
        
        Args:
            lat: Latitude
            lon: Longitude
        
        Returns:
            Dictionary of features:
            {
                'active_fires_7d': int,
                'active_fires_3d': int,
                'fire_max_brightness': float,
                'fire_avg_brightness': float,
                'persistent_fires': int
            }
        """
        # Get 7-day fire data
        fires_7d = self.get_active_fires(lat, lon, radius_km=200, days=7)
        
        # Get 3-day fire data (more recent)
        fires_3d = self.get_active_fires(lat, lon, radius_km=200, days=3)
        
        features = {
            'active_fires_7d': fires_7d['count'],
            'active_fires_3d': fires_3d['count'],
            'fire_max_brightness': fires_7d['max_brightness'],
            'fire_avg_brightness': fires_7d['avg_brightness'],
            'persistent_fires': fires_7d['persistent_fires']
        }
        
        logger.debug(f"Fire features for ({lat}, {lon}): {features}")
        return features


def test_firms_client():
    """Test FIRMS client with known fire-prone location."""
    client = FIRMSClient()
    
    # Test Los Angeles (often has wildfires)
    print("Testing FIRMS API with Los Angeles...")
    lat, lon = 34.0522, -118.2437
    
    fires = client.get_active_fires(lat, lon, radius_km=200, days=7)
    
    print(f"\n✓ Active fires detected: {fires['count']}")
    print(f"✓ Max brightness: {fires['max_brightness']:.1f}K")
    print(f"✓ Avg brightness: {fires['avg_brightness']:.1f}K")
    print(f"✓ Persistent fires: {fires['persistent_fires']}")
    
    # Get ML features
    features = client.get_fire_features(lat, lon)
    print(f"\nML Features: {features}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    test_firms_client()
