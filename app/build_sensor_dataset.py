#!/usr/bin/env python3
"""
Dataset Builder for Sensor-based RiskRadar V4

Creates training datasets with:
- Weekly samples (not just 1st of month)
- Time-based train/test split
- Sensor-based labels (FIRMS + USGS)
- Leakage-free features

Author: RiskRadar Team
Date: 2025-12-23
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
import logging
from typing import Tuple, List
import sys
import time

# Local imports
from sensor_labels import generate_labels_for_dataset
from sensor_features import extract_all_features
from config import Config

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== CONFIGURATION ====================

# Dataset Configuration
START_DATE = '2024-06-01'  # Beginn des Zeitraums
END_DATE = '2025-11-01'    # Ende (exklusiv für Prediction Window) - ERWEITERT!
SAMPLE_FREQUENCY_DAYS = 7  # Wöchentliche Samples (nicht täglich = zu viel)

# Train/Test Split Configuration
TEST_SPLIT_DATE = '2025-07-01'  # Time-based split: everything after this goes to test set
# Train: 2024-06-01 to 2025-06-30 (~13 months)
# Test:  2025-07-01 to 2025-11-01 (4 months)

# Paths - relative to project root, works both locally and in Docker
OUTPUT_DIR = Path(Config.OUTPUT_DIR)
BASE_DIR = Path(__file__).parent.parent
#FIRMS_2024_CSV = BASE_DIR / 'FIRMS_2024_ARCHIVE' / 'fire_archive_M-C61_699932.csv'
#FIRMS_2025_ARCHIVE_CSV = BASE_DIR / 'FIRMS_2025_NRT' / 'fire_archive_M-C61_699365.csv'
#FIRMS_2025_NRT_CSV = BASE_DIR / 'FIRMS_2025_NRT' / 'fire_nrt_M-C61_699365.csv'
#SITES_CSV = Path(Config.DATA_DIR) / 'standorte.csv'

FIRMS_2024_CSV = BASE_DIR / 'FIRMS_2024_ARCHIVE' / 'fire_archive_M-C61_702295.csv'
FIRMS_2025_ARCHIVE_CSV = BASE_DIR / 'FIRMS_2025_NRT' / 'fire_archive_M-C61_702294.csv'
FIRMS_2025_NRT_CSV = BASE_DIR / 'FIRMS_2025_NRT' / 'fire_nrt_M-C61_702294'
SITES_CSV = Path(Config.DATA_DIR) / 'standorte.csv'


# ==================== DATE GENERATION ====================

def generate_sample_dates(
    start_date: str,
    end_date: str,
    frequency_days: int = SAMPLE_FREQUENCY_DAYS
) -> List[pd.Timestamp]:
    """
    Generate list of sample dates with given frequency.
    
    Args:
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD, exclusive)
        frequency_days: Days between samples
        
    Returns:
        List of pd.Timestamp (UTC)
    """
    start = pd.Timestamp(start_date, tz='UTC')
    end = pd.Timestamp(end_date, tz='UTC')
    
    dates = []
    current = start
    
    while current < end:
        dates.append(current)
        current += timedelta(days=frequency_days)
    
    logger.info(f"Generated {len(dates)} sample dates ({start_date} to {end_date}, every {frequency_days} days)")
    return dates


# ==================== DATA LOADING ====================

def load_firms_data(csv_path: Path) -> pd.DataFrame:
    """
    Load FIRMS CSV with required columns.
    
    Args:
        csv_path: Path to FIRMS CSV file
        
    Returns:
        DataFrame with [latitude, longitude, acq_date, acq_time, confidence, brightness, frp]
    """
    logger.info(f"Loading FIRMS data from {csv_path}...")
    
    if not csv_path.exists():
        raise FileNotFoundError(f"FIRMS CSV not found: {csv_path}")
    
    # Nur benötigte Spalten laden (spart Speicher)
    usecols = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'brightness', 'frp']
    
    # Check if 'daynight' column exists (needed for filtering)
    try:
        # Read first row to check columns
        sample = pd.read_csv(csv_path, nrows=1)
        if 'daynight' in sample.columns:
            usecols.append('daynight')
    except:
        pass
    
    df = pd.read_csv(csv_path, usecols=usecols)
    
    # Datum konvertieren
    df['acq_date'] = pd.to_datetime(df['acq_date'])
    
    # Zeitzone: UTC (FIRMS ist UTC)
    df['acq_date'] = df['acq_date'].dt.tz_localize('UTC')
    
    logger.info(f"  Loaded {len(df):,} FIRMS detections")
    logger.info(f"  Date range: {df['acq_date'].min()} to {df['acq_date'].max()}")
    
    return df


def load_combined_firms_data() -> pd.DataFrame:
    """
    Load and combine all available FIRMS data sources:
    - FIRMS_2024_ARCHIVE (Dec 2023 - Dec 2024)
    - FIRMS_2025_ARCHIVE (Dec 2024 - Jul 2025)
    - FIRMS_2025_NRT (Aug 2025 - Dec 2025)
    
    Returns:
        Combined DataFrame with all fire detections (8.5M+)
        
    Note:
        Works with any combination of available CSV files.
        At least one file must be present.
    """
    logger.info("Loading FIRMS data from multiple sources...")
    logger.info("="*70)
    
    dfs = []
    
    # Load 2024 Archive (if available)
    if FIRMS_2024_CSV.exists():
        df_2024 = load_firms_data(FIRMS_2024_CSV)
        logger.info(f"  2024 Archive: {len(df_2024):,} detections")
        dfs.append(df_2024)
    else:
        logger.warning(f"  2024 Archive not found: {FIRMS_2024_CSV}")
    
    # Load 2025 Archive (if available)
    if FIRMS_2025_ARCHIVE_CSV.exists():
        df_2025_archive = load_firms_data(FIRMS_2025_ARCHIVE_CSV)
        logger.info(f"  2025 Archive: {len(df_2025_archive):,} detections")
        dfs.append(df_2025_archive)
    else:
        logger.warning(f"  2025 Archive not found: {FIRMS_2025_ARCHIVE_CSV}")
    
    # Load 2025 NRT (if available)
    if FIRMS_2025_NRT_CSV.exists():
        df_2025_nrt = load_firms_data(FIRMS_2025_NRT_CSV)
        logger.info(f"  2025 NRT: {len(df_2025_nrt):,} detections")
        dfs.append(df_2025_nrt)
    else:
        logger.warning(f"  2025 NRT not found: {FIRMS_2025_NRT_CSV}")
    
    # Check if at least one file was loaded
    if not dfs:
        logger.error("ERROR: No FIRMS CSV files found!")
        logger.error("Please download at least one of the following:")
        logger.error(f"  - {FIRMS_2024_CSV}")
        logger.error(f"  - {FIRMS_2025_ARCHIVE_CSV}")
        logger.error(f"  - {FIRMS_2025_NRT_CSV}")
        raise FileNotFoundError("No FIRMS data files found. Please download data first.")
    
    # Combine all available datasets
    df_combined = pd.concat(dfs, ignore_index=True)
    
    logger.info("="*70)
    logger.info(f"Combined total: {len(df_combined):,} detections")
    logger.info(f"Date range: {df_combined['acq_date'].min()} to {df_combined['acq_date'].max()}")
    logger.info("="*70)
    
    return df_combined


def load_usgs_data_cached() -> pd.DataFrame:
    """
    Load USGS earthquake data (cached or from API).
    
    Returns:
        DataFrame with [latitude, longitude, time, mag, place]
    """
    cache_file = OUTPUT_DIR / 'usgs_earthquakes_cache.csv'
    
    if cache_file.exists():
        logger.info(f"Loading USGS data from cache: {cache_file}")
        df = pd.read_csv(cache_file)
        df['time'] = pd.to_datetime(df['time'], format='ISO8601').dt.tz_localize('UTC')
        logger.info(f"  Loaded {len(df):,} earthquakes from cache")
        return df
    
    logger.info("USGS cache not found. Fetching from API...")
    logger.info("  This may take a while for global dataset...")
    
    # Here you would fetch all earthquakes for the time period
    # For now: Placeholder - you would need to use usgs_client
    logger.error("USGS cache missing! Please run: python usgs_client.py to cache data")
    raise FileNotFoundError(f"USGS cache not found: {cache_file}")


def load_sites(csv_path: Path) -> pd.DataFrame:
    """
    Load site locations.
    
    Returns:
        DataFrame with [name, lat, lon]
    """
    logger.info(f"Loading sites from {csv_path}...")
    df = pd.read_csv(csv_path)
    logger.info(f"  Loaded {len(df)} sites")
    return df


# ==================== DATASET BUILDER ====================

def build_dataset(
    sites_df: pd.DataFrame,
    target_dates: List[pd.Timestamp],
    firms_df: pd.DataFrame,
    usgs_df: pd.DataFrame,
    model_type: str = 'fire',
    weather_api_key: str = None
) -> pd.DataFrame:
    """
    Build complete dataset: Labels + Features.
    
    Args:
        sites_df: Site locations
        target_dates: List of sample dates
        firms_df: FIRMS data
        usgs_df: USGS data
        model_type: 'fire' or 'quake'
        weather_api_key: OpenWeather API Key (optional)
        
    Returns:
        DataFrame with all features + labels
    """
    logger.info(f"\n{'='*60}")
    logger.info(f"Building {model_type.upper()} Dataset")
    logger.info(f"{'='*60}\n")
    
    # 1. Generate labels
    logger.info("Step 1/2: Generating Labels...")
    labels_df = generate_labels_for_dataset(sites_df, target_dates, firms_df, usgs_df)
    
    # 2. Extract features
    logger.info("\nStep 2/2: Extracting Features (incl. Weather Data Collection)...")
    features_list = []
    
    total = len(labels_df)
    
    # Timing statistics for weather data collection
    weather_start_time = time.time()
    weather_fetch_count = 0
    weather_total_time = 0.0
    last_progress_log = time.time()
    
    for idx, row in labels_df.iterrows():
        # Log progress every 50 samples or every 10 seconds
        current_time = time.time()
        if idx % 50 == 0 or (current_time - last_progress_log) >= 10:
            elapsed = current_time - weather_start_time
            elapsed_str = f"{elapsed:.1f}s" if elapsed < 60 else f"{elapsed/60:.1f}min"
            
            # Estimate remaining time
            if idx > 0:
                rate = elapsed / idx  # seconds per sample
                remaining = rate * (total - idx)
                remaining_str = f"{remaining:.0f}s" if remaining < 60 else f"{remaining/60:.1f}min"
                logger.info(f"  Progress: {idx}/{total} ({idx/total*100:.1f}%) | Elapsed: {elapsed_str} | Remaining: ~{remaining_str}")
            else:
                logger.info(f"  Progress: {idx}/{total} ({idx/total*100:.1f}%) | Starting...")
            
            last_progress_log = current_time
        
        site = {
            'name': row['site_name'],
            'lat': row['lat'],
            'lon': row['lon']
        }
        target_date = row['target_date']
        
        # Extract features (only PAST data!) - includes weather API calls
        fetch_start = time.time()
        features = extract_all_features(
            site=site,
            target_date=target_date,
            firms_df=firms_df,
            usgs_df=usgs_df,
            weather_api_key=weather_api_key,
            model_type=model_type,
            use_historical_weather=True  # IMPORTANT: Historical for training!
        )
        fetch_time = time.time() - fetch_start
        
        # Track weather fetch timing (fire model uses weather API)
        if model_type == 'fire':
            weather_fetch_count += 1
            weather_total_time += fetch_time
        
        # Combine with labels
        sample = {
            'site_name': row['site_name'],
            'target_date': row['target_date'],
            'lat': row['lat'],
            'lon': row['lon']
        }
        sample.update(features)
        
        # Add label (depending on model type)
        if model_type == 'fire':
            sample['label'] = row['fire_label']
            sample['label_meta_detections'] = row['fire_detections']
            sample['label_meta_max_brightness'] = row['fire_max_brightness']
        else:  # quake
            sample['label'] = row['quake_label']
            sample['label_meta_events'] = row['quake_events']
            sample['label_meta_max_mag'] = row['quake_max_magnitude']
        
        features_list.append(sample)
    
    # Final progress and timing stats
    total_elapsed = time.time() - weather_start_time
    total_elapsed_str = f"{total_elapsed:.1f}s" if total_elapsed < 60 else f"{total_elapsed/60:.1f}min"
    logger.info(f"  Progress: {total}/{total} (100.0%) | Total Time: {total_elapsed_str}")
    
    # Weather collection statistics (only for fire model)
    if model_type == 'fire' and weather_fetch_count > 0:
        avg_weather_time = weather_total_time / weather_fetch_count
        logger.info(f"\nWeather Data Collection Summary:")
        logger.info(f"  Total API Calls: {weather_fetch_count}")
        logger.info(f"  Total Weather Time: {weather_total_time:.1f}s ({weather_total_time/60:.1f}min)")
        logger.info(f"  Avg Time per Call: {avg_weather_time*1000:.0f}ms")
    
    # DataFrame erstellen
    dataset_df = pd.DataFrame(features_list)
    
    # Stats
    logger.info(f"\nDataset Statistics:")
    logger.info(f"  Total Samples: {len(dataset_df)}")
    logger.info(f"  Positive Labels: {dataset_df['label'].sum()} ({dataset_df['label'].mean()*100:.1f}%)")
    logger.info(f"  Negative Labels: {(dataset_df['label']==0).sum()} ({(dataset_df['label']==0).mean()*100:.1f}%)")
    logger.info(f"  Features: {len([c for c in dataset_df.columns if c not in ['site_name', 'target_date', 'label', 'lat', 'lon', 'label_meta_detections', 'label_meta_max_brightness', 'label_meta_events', 'label_meta_max_mag']])}")
    
    return dataset_df


# ==================== TRAIN/TEST SPLIT ====================

def stratified_random_split(
    dataset_df: pd.DataFrame,
    test_size: float = 0.20,
    random_state: int = 42
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Splittet Dataset stratifiziert (erhält Label-Verteilung).
    Besser für Imbalanced Data als Time-based Split.
    
    Args:
        dataset_df: Komplettes Dataset
        test_size: Anteil für Test (0.20 = 20%)
        random_state: Seed für Reproduzierbarkeit
        
    Returns:
        (train_df, test_df)
    """
    from sklearn.model_selection import train_test_split
    
    # Indices für Split
    train_idx, test_idx = train_test_split(
        dataset_df.index,
        test_size=test_size,
        stratify=dataset_df['label'],  # Erhält Positive/Negative Ratio!
        random_state=random_state
    )
    
    train_df = dataset_df.loc[train_idx].copy()
    test_df = dataset_df.loc[test_idx].copy()
    
    logger.info(f"\nStratified Random Split (Test Size: {test_size*100:.0f}%):")
    logger.info(f"  Train Set: {len(train_df)} samples")
    logger.info(f"    Positive: {train_df['label'].sum()} ({train_df['label'].mean()*100:.1f}%)")
    logger.info(f"    Negative: {(train_df['label']==0).sum()}")
    logger.info(f"  Test Set: {len(test_df)} samples")
    logger.info(f"    Positive: {test_df['label'].sum()} ({test_df['label'].mean()*100:.1f}%)")
    logger.info(f"    Negative: {(test_df['label']==0).sum()}")
    
    return train_df, test_df


def time_based_split(
    dataset_df: pd.DataFrame,
    split_date: str = TEST_SPLIT_DATE
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Splittet Dataset zeitbasiert.
    
    Args:
        dataset_df: Komplettes Dataset
        split_date: Datum ab dem Test-Set beginnt
        
    Returns:
        (train_df, test_df)
    """
    split_ts = pd.Timestamp(split_date, tz='UTC')
    
    train_df = dataset_df[dataset_df['target_date'] < split_ts].copy()
    test_df = dataset_df[dataset_df['target_date'] >= split_ts].copy()
    
    logger.info(f"\nTime-based Split (Split Date: {split_date}):")
    logger.info(f"  Train Set: {len(train_df)} samples")
    logger.info(f"    Date Range: {train_df['target_date'].min()} to {train_df['target_date'].max()}")
    logger.info(f"    Positive: {train_df['label'].sum()} ({train_df['label'].mean()*100:.1f}%)")
    logger.info(f"  Test Set: {len(test_df)} samples")
    logger.info(f"    Date Range: {test_df['target_date'].min()} to {test_df['target_date'].max()}")
    logger.info(f"    Positive: {test_df['label'].sum()} ({test_df['label'].mean()*100:.1f}%)")
    
    return train_df, test_df


# ==================== MAIN ====================

def main():
    """Main Dataset Builder Pipeline."""
    
    logger.info("="*80)
    logger.info("RISKRADAR V4 - SENSOR-BASED DATASET BUILDER")
    logger.info("="*80)
    
    # 0. Output Directory
    OUTPUT_DIR.mkdir(exist_ok=True, parents=True)
    
    # 1. Sample Dates generieren
    logger.info(f"\n1. Generating Sample Dates...")
    target_dates = generate_sample_dates(START_DATE, END_DATE, SAMPLE_FREQUENCY_DAYS)
    
    # 2. Load data
    logger.info(f"\n2. Loading Data...")
    sites_df = load_sites(SITES_CSV)
    firms_df = load_combined_firms_data()
    
    try:
        usgs_df = load_usgs_data_cached()
    except FileNotFoundError:
        logger.warning("USGS data not available. Creating dummy USGS data for testing...")
        # Dummy USGS data for testing
        usgs_df = pd.DataFrame({
            'latitude': [],
            'longitude': [],
            'time': pd.to_datetime([]),
            'mag': []
        })
        usgs_df['time'] = usgs_df['time'].dt.tz_localize('UTC')
    
    # 3. Build Fire Risk Dataset
    logger.info(f"\n3. Building FIRE Risk Dataset...")
    fire_dataset = build_dataset(
        sites_df=sites_df,
        target_dates=target_dates,
        firms_df=firms_df,
        usgs_df=usgs_df,
        model_type='fire',
        weather_api_key=None  # Nutze Defaults (keine API Calls beim Batch)
    )
    
    # 4. Train/Test Split (Fire) - STRATIFIED!
    logger.info(f"\n4. Splitting Fire Dataset...")
    fire_train, fire_test = stratified_random_split(fire_dataset, test_size=0.20)
    
    # 5. Speichern (Fire)
    fire_train_path = OUTPUT_DIR / 'fire_train.csv'
    fire_test_path = OUTPUT_DIR / 'fire_test.csv'
    
    fire_train.to_csv(fire_train_path, index=False)
    fire_test.to_csv(fire_test_path, index=False)
    
    logger.info(f"\n5. Saved Fire Datasets:")
    logger.info(f"  Train: {fire_train_path}")
    logger.info(f"  Test:  {fire_test_path}")
    
    # 6. Build Quake Risk Dataset (optional, wenn USGS verfügbar)
    if len(usgs_df) > 0:
        logger.info(f"\n6. Building QUAKE Risk Dataset...")
        quake_dataset = build_dataset(
            sites_df=sites_df,
            target_dates=target_dates,
            firms_df=firms_df,
            usgs_df=usgs_df,
            model_type='quake',
            weather_api_key=None
        )
        
        # 7. Stratified Split (Quake)
        logger.info(f"\n7. Splitting Quake Dataset...")
        quake_train, quake_test = stratified_random_split(quake_dataset, test_size=0.20)
        
        # 8. Speichern (Quake)
        quake_train_path = OUTPUT_DIR / 'quake_train.csv'
        quake_test_path = OUTPUT_DIR / 'quake_test.csv'
        
        quake_train.to_csv(quake_train_path, index=False)
        quake_test.to_csv(quake_test_path, index=False)
        
        logger.info(f"\n8. Saved Quake Datasets:")
        logger.info(f"  Train: {quake_train_path}")
        logger.info(f"  Test:  {quake_test_path}")
    else:
        logger.warning("\nSkipping Quake Dataset (no USGS data)")
    
    # Done
    logger.info("\n" + "="*80)
    logger.info("Dataset building complete!")
    logger.info("="*80)
    logger.info(f"\nNext Steps:")
    logger.info(f"  1. Train Fire Model:  python train_sensor_model.py --model fire")
    logger.info(f"  2. Train Quake Model: python train_sensor_model.py --model quake")
    logger.info(f"  3. Run Predictions:   python run_sensor_forecast.py")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.error(f"\nERROR: {e}", exc_info=True)
        sys.exit(1)
