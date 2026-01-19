"""
NASA FIRMS Data Updater

Downloads the latest NRT (Near Real-Time) fire data from NASA FIRMS API
and updates the local CSV files.

NASA FIRMS API Documentation:
https://firms.modaps.eosdis.nasa.gov/api/
"""

import os
import sys
import logging
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv
from config import Config

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(env_path)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# NASA FIRMS API Configuration
# To get a MAP_KEY, visit: https://firms.modaps.eosdis.nasa.gov/api/area/
FIRMS_MAP_KEY = os.getenv('FIRMS_MAP_KEY', None)

# If no API key, you need to register at:
# https://firms.modaps.eosdis.nasa.gov/api/area/
DEFAULT_MAP_KEY = "YOUR_MAP_KEY_HERE"  # Replace with your key!

# FIRMS NRT API endpoint (last 7 days max for free tier)
FIRMS_NRT_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/MODIS_NRT/{area_definition}/{days_back}"

# World bounding box (all fires globally)
WORLD_BBOX = "-180,-90,180,90"  # west,south,east,north


def get_latest_local_date(nrt_file: Path) -> datetime:
    """Get the latest date from local NRT CSV file."""
    if not nrt_file.exists():
        logger.warning(f"NRT file not found: {nrt_file}")
        return datetime(2025, 12, 22)  # Default to last known date
    
    try:
        df = pd.read_csv(nrt_file)
        df['acq_date'] = pd.to_datetime(df['acq_date'])
        latest_date = df['acq_date'].max()
        logger.info(f"Latest local date: {latest_date.date()}")
        return latest_date
    except Exception as e:
        logger.error(f"Error reading NRT file: {e}")
        return datetime(2025, 12, 22)


def download_firms_nrt(map_key: str, days_back: int = 7) -> pd.DataFrame:
    """
    Download NRT fire data from NASA FIRMS API.
    
    Args:
        map_key: Your NASA FIRMS MAP_KEY
        days_back: Number of days to fetch (max 7 for free tier)
    
    Returns:
        DataFrame with fire detections
    """
    url = FIRMS_NRT_URL.format(
        map_key=map_key,
        area_definition=WORLD_BBOX,
        days_back=days_back
    )
    
    logger.info(f"Downloading FIRMS NRT data (last {days_back} days)...")
    logger.info(f"URL: {url}")
    
    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        
        # Parse CSV from response
        from io import StringIO
        csv_data = StringIO(response.text)
        df = pd.read_csv(csv_data)
        
        logger.info(f"✓ Downloaded {len(df):,} fire detections")
        logger.info(f"  Date range: {df['acq_date'].min()} to {df['acq_date'].max()}")
        
        return df
    
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 404:
            logger.error("API Error: Invalid MAP_KEY or no data available!")
            logger.error("Get your MAP_KEY at: https://firms.modaps.eosdis.nasa.gov/api/area/")
        else:
            logger.error(f"HTTP Error: {e}")
        raise
    
    except Exception as e:
        logger.error(f"Error downloading FIRMS data: {e}")
        raise


def update_nrt_file(nrt_file: Path, new_data: pd.DataFrame):
    """Append new data to NRT file (avoid duplicates)."""
    if not nrt_file.exists():
        logger.info(f"Creating new NRT file: {nrt_file}")
        new_data.to_csv(nrt_file, index=False)
        logger.info(f"✓ Saved {len(new_data):,} detections")
        return
    
    # Load existing data
    df_existing = pd.read_csv(nrt_file)
    logger.info(f"Existing NRT data: {len(df_existing):,} detections")
    
    # Combine and remove duplicates
    df_combined = pd.concat([df_existing, new_data], ignore_index=True)
    
    # Remove duplicates based on key columns
    df_combined = df_combined.drop_duplicates(
        subset=['latitude', 'longitude', 'acq_date', 'acq_time'],
        keep='last'
    )
    
    # Sort by date
    df_combined['acq_date'] = pd.to_datetime(df_combined['acq_date'])
    df_combined = df_combined.sort_values('acq_date')
    
    # Save
    df_combined.to_csv(nrt_file, index=False)
    
    new_count = len(df_combined) - len(df_existing)
    logger.info(f"✓ Added {new_count:,} new detections")
    logger.info(f"✓ Total NRT data: {len(df_combined):,} detections")


def main():
    """Main function to update FIRMS NRT data."""
    logger.info("=" * 80)
    logger.info("NASA FIRMS DATA UPDATER")
    logger.info("=" * 80)
    
    # Check if MAP_KEY is available
    if not FIRMS_MAP_KEY or FIRMS_MAP_KEY == "YOUR_MAP_KEY_HERE":
        logger.error("=" * 80)
        logger.error("ERROR: No NASA FIRMS MAP_KEY found!")
        logger.error("=" * 80)
        sys.exit(1)
    
    # Paths (from Config)
    nrt_dir = Path(Config.FIRMS_2025_DIR)
    nrt_file = Path(Config.FIRMS_NRT_2025_FILE)
    
    nrt_dir.mkdir(exist_ok=True)
    
    # Check latest local date
    latest_local = get_latest_local_date(nrt_file)
    days_missing = (datetime.now() - latest_local).days
    
    logger.info("")
    logger.info(f"Latest local date: {latest_local.date()}")
    logger.info(f"Today: {datetime.now().date()}")
    logger.info(f"Days missing: {days_missing}")
    
    if days_missing <= 0:
        logger.info("")
        logger.info("✓ Data is up-to-date!")
        return
    
    # Download new data (max 7 days for free tier)
    days_to_fetch = min(days_missing, 7)
    logger.info(f"Fetching last {days_to_fetch} days from NASA FIRMS API...")
    logger.info("")
    
    try:
        new_data = download_firms_nrt(FIRMS_MAP_KEY, days_back=days_to_fetch)
        
        # Update local file
        update_nrt_file(nrt_file, new_data)
        
        logger.info("")
        logger.info("=" * 80)
        logger.info("✓ UPDATE COMPLETE!")
        logger.info("=" * 80)
        logger.info("")
        logger.info("Next steps:")
        logger.info("  1. Re-run dataset builder: python build_sensor_dataset.py")
        logger.info("  2. Re-train models:        python train_sensor_model.py --model fire")
        logger.info("  3. Generate forecast:      python run_real_forecast.py")
        logger.info("")
    
    except Exception as e:
        logger.error("")
        logger.error("=" * 80)
        logger.error("✗ UPDATE FAILED!")
        logger.error("=" * 80)
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
