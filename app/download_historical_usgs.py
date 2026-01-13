#!/usr/bin/env python3
"""
Historical USGS Earthquake Data Downloader

Downloads earthquake data from USGS API for extended time periods.
Respects API rate limits and caches results.

Usage:
    python download_historical_usgs.py --years 5
    python download_historical_usgs.py --start 2019-01-01 --end 2024-12-31
"""

import pandas as pd
import requests
from datetime import datetime, timedelta
from pathlib import Path
import logging
import argparse
import time
import json
from typing import List
from config import Config

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Configuration
OUTPUT_FILE = Path(Config.DATA_DIR) / 'usgs_historical.csv'
CACHE_DIR = Path(Config.DATA_DIR) / 'cache'
USGS_API_BASE = "https://earthquake.usgs.gov/fdsnws/event/1/query"

# API Parameters
MIN_MAGNITUDE = 2.0  # Match model requirements
MAX_RESULTS_PER_REQUEST = 20000  # USGS API limit
REQUEST_DELAY = 1.0  # Seconds between requests (be nice to API)


def download_usgs_month(year: int, month: int, delay: float = REQUEST_DELAY) -> pd.DataFrame:
    """
    Download USGS data for a specific month.
    
    Args:
        year: Year (e.g., 2019)
        month: Month (1-12)
        delay: Delay in seconds after request
        
    Returns:
        DataFrame with earthquake data
    """
    # Calculate start and end dates for the month
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)
    
    # Check cache first
    cache_file = CACHE_DIR / f'usgs_{year}_{month:02d}.csv'
    if cache_file.exists():
        logger.info(f"  ✓ Using cached data for {year}-{month:02d}")
        return pd.read_csv(cache_file)
    
    # API parameters
    params = {
        'format': 'geojson',
        'starttime': start_date.strftime('%Y-%m-%d'),
        'endtime': end_date.strftime('%Y-%m-%d'),
        'minmagnitude': MIN_MAGNITUDE,
        'orderby': 'time-asc',
        'limit': MAX_RESULTS_PER_REQUEST
    }
    
    try:
        response = requests.get(USGS_API_BASE, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        features = data.get('features', [])
        
        if not features:
            logger.info(f"  {year}-{month:02d}: No data")
            return pd.DataFrame()
        
        # Extract relevant fields
        records = []
        for feature in features:
            props = feature['properties']
            coords = feature['geometry']['coordinates']
            
            records.append({
                'time': pd.to_datetime(props['time'], unit='ms', utc=True),
                'latitude': coords[1],
                'longitude': coords[0],
                'depth': coords[2],
                'mag': props['mag'],
                'place': props.get('place', ''),
                'type': props.get('type', 'earthquake')
            })
        
        df = pd.DataFrame(records)
        
        # Cache the result
        CACHE_DIR.mkdir(exist_ok=True, parents=True)
        df.to_csv(cache_file, index=False)
        
        logger.info(f"  {year}-{month:02d}: Downloaded {len(df)} events")
        
        # Rate limiting
        time.sleep(delay)
        
        return df
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error downloading {year}-{month:02d}: {e}")
        return pd.DataFrame()


def download_historical_data(
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    delay: float = REQUEST_DELAY
) -> pd.DataFrame:
    """
    Download USGS data for a date range (month by month).
    
    Args:
        start_year: Start year
        start_month: Start month (1-12)
        end_year: End year
        end_month: End month (1-12)
        delay: Delay between requests
        
    Returns:
        Combined DataFrame
    """
    logger.info("="*60)
    logger.info("DOWNLOADING HISTORICAL USGS EARTHQUAKE DATA")
    logger.info("="*60)
    logger.info(f"Time range: {start_year}-{start_month:02d} to {end_year}-{end_month:02d}")
    logger.info(f"Min magnitude: {MIN_MAGNITUDE}")
    logger.info(f"Delay between requests: {delay}s")
    logger.info("")
    
    all_data = []
    
    current_year = start_year
    current_month = start_month
    
    total_months = (end_year - start_year) * 12 + (end_month - start_month) + 1
    month_counter = 0
    
    while (current_year < end_year) or (current_year == end_year and current_month <= end_month):
        month_counter += 1
        logger.info(f"[{month_counter}/{total_months}] {current_year}-{current_month:02d}")
        
        df = download_usgs_month(current_year, current_month, delay)
        if not df.empty:
            all_data.append(df)
        
        # Next month
        current_month += 1
        if current_month > 12:
            current_month = 1
            current_year += 1
    
    if not all_data:
        logger.error("No data downloaded!")
        return pd.DataFrame()
    
    # Combine all months
    logger.info("\nCombining data...")
    combined_df = pd.concat(all_data, ignore_index=True)
    
    # Sort by time
    combined_df = combined_df.sort_values('time').reset_index(drop=True)
    
    logger.info(f"\n✓ Download complete!")
    logger.info(f"  Total events: {len(combined_df):,}")
    logger.info(f"  Time range: {combined_df['time'].min()} to {combined_df['time'].max()}")
    logger.info(f"  Magnitude range: {combined_df['mag'].min():.1f} - {combined_df['mag'].max():.1f}")
    
    return combined_df


def save_data(df: pd.DataFrame, output_path: Path):
    """Save DataFrame to CSV."""
    logger.info(f"\nSaving to {output_path}...")
    output_path.parent.mkdir(exist_ok=True, parents=True)
    df.to_csv(output_path, index=False)
    logger.info(f"✓ Saved {len(df):,} records ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description='Download historical USGS earthquake data')
    
    # Option 1: Specify number of years back from now
    parser.add_argument('--years', type=int, help='Number of years to download (counting back from today)')
    
    # Option 2: Specify exact date range
    parser.add_argument('--start', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='End date (YYYY-MM-DD)')
    
    # Optional: delay between requests
    parser.add_argument('--delay', type=float, default=REQUEST_DELAY, 
                        help=f'Delay between API requests in seconds (default: {REQUEST_DELAY})')
    
    args = parser.parse_args()
    
    # Determine date range
    if args.years:
        # Calculate date range from years
        end_date = datetime.now()
        start_date = end_date - timedelta(days=args.years * 365)
        
        start_year = start_date.year
        start_month = start_date.month
        end_year = end_date.year
        end_month = end_date.month
        
    elif args.start and args.end:
        # Use provided dates
        start_date = datetime.strptime(args.start, '%Y-%m-%d')
        end_date = datetime.strptime(args.end, '%Y-%m-%d')
        
        start_year = start_date.year
        start_month = start_date.month
        end_year = end_date.year
        end_month = end_date.month
        
    else:
        # Default: 5 years
        logger.info("No date range specified. Using default: 5 years")
        end_date = datetime.now()
        start_date = end_date - timedelta(days=5 * 365)
        
        start_year = start_date.year
        start_month = start_date.month
        end_year = end_date.year
        end_month = end_date.month
    
    # Download data
    df = download_historical_data(
        start_year, start_month,
        end_year, end_month,
        delay=args.delay
    )
    
    if df.empty:
        logger.error("No data to save!")
        return 1
    
    # Save to file
    save_data(df, OUTPUT_FILE)
    
    logger.info("\n" + "="*60)
    logger.info("✓ DOWNLOAD COMPLETE")
    logger.info("="*60)
    logger.info(f"\nNext steps:")
    logger.info(f"  1. Update build_sensor_dataset.py with new date range")
    logger.info(f"  2. Run: python app/build_sensor_dataset.py")
    logger.info(f"  3. Run: python app/train_sensor_model.py --model quake")
    logger.info("")
    
    return 0


if __name__ == '__main__':
    exit(main())
