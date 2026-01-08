#!/usr/bin/env python3
"""
Open-Meteo Client for historical and forecast weather data.

FREE - No API key required!
Docs: https://open-meteo.com/

Features:
- Historical Weather (1940 - present)
- 7-day Forecast
- Worldwide coverage
- ERA5 Reanalysis data (high quality)
"""

import requests
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Optional
import pandas as pd

logger = logging.getLogger(__name__)

# Rate limiting configuration
_last_request_time = 0
MIN_REQUEST_INTERVAL = 0.3  # 300ms between requests (~3 req/sec, safe for free tier)
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2  # Exponential backoff: 2s, 4s, 8s


def _rate_limited_request(url: str, params: dict, timeout: int = 30) -> requests.Response:
    """
    Make a rate-limited request with retry logic for 429 errors.
    
    Args:
        url: API URL
        params: Query parameters
        timeout: Request timeout in seconds
        
    Returns:
        Response object
        
    Raises:
        requests.HTTPError: If all retries fail
    """
    global _last_request_time
    
    for attempt in range(MAX_RETRIES):
        # Rate limiting: ensure minimum interval between requests
        elapsed = time.time() - _last_request_time
        if elapsed < MIN_REQUEST_INTERVAL:
            time.sleep(MIN_REQUEST_INTERVAL - elapsed)
        
        _last_request_time = time.time()
        
        try:
            response = requests.get(url, params=params, timeout=timeout)
            
            if response.status_code == 429:
                # Rate limited - exponential backoff
                wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
                logger.warning(f"Rate limited (429). Waiting {wait_time}s before retry {attempt + 1}/{MAX_RETRIES}...")
                time.sleep(wait_time)
                continue
            
            response.raise_for_status()
            return response
            
        except requests.exceptions.Timeout:
            wait_time = RETRY_BACKOFF_BASE ** (attempt + 1)
            logger.warning(f"Request timeout. Waiting {wait_time}s before retry {attempt + 1}/{MAX_RETRIES}...")
            time.sleep(wait_time)
            continue
    
    # All retries exhausted
    raise requests.HTTPError(f"Failed after {MAX_RETRIES} retries")


def get_historical_weather(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str
) -> Optional[pd.DataFrame]:
    """
    Fetch historical weather data from Open-Meteo.
    
    Args:
        lat: Latitude
        lon: Longitude
        start_date: Start date (YYYY-MM-DD)
        end_date: End date (YYYY-MM-DD)
        
    Returns:
        DataFrame with daily weather data or None on error
        
    Example:
        >>> df = get_historical_weather(48.1351, 11.5820, '2024-06-01', '2024-06-07')
        >>> print(df[['date', 'temperature_2m_mean', 'precipitation_sum']])
    """
    try:
        url = "https://archive-api.open-meteo.com/v1/archive"
        
        params = {
            'latitude': lat,
            'longitude': lon,
            'start_date': start_date,
            'end_date': end_date,
            'daily': ','.join([
                'temperature_2m_max',
                'temperature_2m_min',
                'temperature_2m_mean',
                'precipitation_sum',
                'rain_sum',
                'windspeed_10m_max',
                'relative_humidity_2m_max',
                'relative_humidity_2m_min',
                'relative_humidity_2m_mean'
            ]),
            'timezone': 'auto'
        }
        
        response = _rate_limited_request(url, params, timeout=30)
        
        data = response.json()
        
        # Parse to DataFrame
        if 'daily' in data:
            df = pd.DataFrame(data['daily'])
            df['date'] = pd.to_datetime(df['time'])
            return df
        else:
            logger.warning(f"No daily data in response for {lat}, {lon}")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching historical weather: {e}")
        return None


def get_forecast_weather(
    lat: float,
    lon: float,
    days: int = 7
) -> Optional[pd.DataFrame]:
    """
    Fetch forecast weather data from Open-Meteo.
    
    Args:
        lat: Latitude
        lon: Longitude
        days: Number of days (max 16)
        
    Returns:
        DataFrame with daily forecast data or None on error
    """
    try:
        url = "https://api.open-meteo.com/v1/forecast"
        
        params = {
            'latitude': lat,
            'longitude': lon,
            'daily': ','.join([
                'temperature_2m_max',
                'temperature_2m_min',
                'temperature_2m_mean',
                'precipitation_sum',
                'rain_sum',
                'windspeed_10m_max',
                'relative_humidity_2m_max',
                'relative_humidity_2m_min',
                'relative_humidity_2m_mean'
            ]),
            'forecast_days': min(days, 16),
            'timezone': 'auto'
        }
        
        response = _rate_limited_request(url, params, timeout=30)
        
        data = response.json()
        
        if 'daily' in data:
            df = pd.DataFrame(data['daily'])
            df['date'] = pd.to_datetime(df['time'])
            return df
        else:
            logger.warning(f"No daily data in response for {lat}, {lon}")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching forecast weather: {e}")
        return None


def extract_weather_features_from_df(
    df: pd.DataFrame,
    days: int = 7
) -> Dict[str, float]:
    """
    Extract weather features from a DataFrame.
    
    Args:
        df: DataFrame with weather data
        days: Number of days for aggregation (last N days)
        
    Returns:
        Dict with 7 features
    """
    # Take last N days
    df_subset = df.tail(days)
    
    features = {}
    
    # Temperature Features
    features['temp_mean'] = df_subset['temperature_2m_mean'].mean()
    features['temp_max'] = df_subset['temperature_2m_max'].max()
    
    # Humidity Features
    features['humidity_mean'] = df_subset['relative_humidity_2m_mean'].mean()
    features['humidity_min'] = df_subset['relative_humidity_2m_min'].min()
    
    # Wind Features
    features['wind_max'] = df_subset['windspeed_10m_max'].max()
    
    # Rain Features
    features['rain_total'] = df_subset['precipitation_sum'].sum()
    
    # Dry Days (days with <1mm precipitation)
    features['dry_days'] = len(df_subset[df_subset['precipitation_sum'] < 1.0])
    
    return features


def get_historical_weather_features(
    lat: float,
    lon: float,
    target_date: str,
    lookback_days: int = 7
) -> Dict[str, float]:
    """
    Fetch historical weather features for a specific date.
    
    Args:
        lat: Latitude
        lon: Longitude
        target_date: Target date (YYYY-MM-DD)
        lookback_days: Days back for features (e.g. 7 = last 7 days BEFORE target_date)
        
    Returns:
        Dict with 7 weather features
        
    Example:
        >>> # Features for 2024-06-15 based on 7 days before (08-14 Jun)
        >>> features = get_historical_weather_features(48.1351, 11.5820, '2024-06-15', 7)
    """
    try:
        target = pd.to_datetime(target_date)
        end_date = target - timedelta(days=1)  # Day BEFORE target_date
        start_date = end_date - timedelta(days=lookback_days - 1)
        
        df = get_historical_weather(
            lat, lon,
            start_date.strftime('%Y-%m-%d'),
            end_date.strftime('%Y-%m-%d')
        )
        
        if df is None or len(df) == 0:
            logger.warning(f"No historical weather data for {lat}, {lon} on {target_date}")
            # Default values
            return {
                'temp_mean': 15.0,
                'temp_max': 20.0,
                'humidity_mean': 60.0,
                'humidity_min': 40.0,
                'wind_max': 5.0,
                'rain_total': 0.0,
                'dry_days': lookback_days
            }
        
        return extract_weather_features_from_df(df, lookback_days)
        
    except Exception as e:
        logger.error(f"Error getting historical weather features: {e}")
        # Default values on error
        return {
            'temp_mean': 15.0,
            'temp_max': 20.0,
            'humidity_mean': 60.0,
            'humidity_min': 40.0,
            'wind_max': 5.0,
            'rain_total': 0.0,
            'dry_days': lookback_days
        }


def get_forecast_weather_features(
    lat: float,
    lon: float,
    days: int = 3
) -> Dict[str, float]:
    """
    Fetch forecast weather features for the next N days.
    
    Args:
        lat: Latitude
        lon: Longitude
        days: Number of days forecast (e.g. 3 for 72h)
        
    Returns:
        Dict with 7 weather features
    """
    try:
        df = get_forecast_weather(lat, lon, days)
        
        if df is None or len(df) == 0:
            logger.warning(f"No forecast weather data for {lat}, {lon}")
            # Default values
            return {
                'temp_mean': 15.0,
                'temp_max': 20.0,
                'humidity_mean': 60.0,
                'humidity_min': 40.0,
                'wind_max': 5.0,
                'rain_total': 0.0,
                'dry_days': days
            }
        
        return extract_weather_features_from_df(df, days)
        
    except Exception as e:
        logger.error(f"Error getting forecast weather features: {e}")
        return {
            'temp_mean': 15.0,
            'temp_max': 20.0,
            'humidity_mean': 60.0,
            'humidity_min': 40.0,
            'wind_max': 5.0,
            'rain_total': 0.0,
            'dry_days': days
        }


if __name__ == '__main__':
    # Test
    logging.basicConfig(level=logging.INFO)
    
    print("Testing Open-Meteo Client...")
    print("=" * 60)
    
    # Test Historical
    print("\n1. Historical Weather (Munich, 1-7 Jun 2024):")
    df = get_historical_weather(48.1351, 11.5820, '2024-06-01', '2024-06-07')
    if df is not None:
        print(df[['date', 'temperature_2m_mean', 'precipitation_sum', 'relative_humidity_2m_mean']])
    
    # Test Historical Features
    print("\n2. Historical Features (Munich, 15 Jun 2024, 7d lookback):")
    features = get_historical_weather_features(48.1351, 11.5820, '2024-06-15', 7)
    for k, v in features.items():
        print(f"   {k}: {v:.1f}")
    
    # Test Forecast
    print("\n3. Forecast Weather (Munich, 3 days):")
    df_forecast = get_forecast_weather(48.1351, 11.5820, 3)
    if df_forecast is not None:
        print(df_forecast[['date', 'temperature_2m_mean', 'precipitation_sum']])
    
    # Test Forecast Features
    print("\n4. Forecast Features (Munich, 3 days):")
    features_forecast = get_forecast_weather_features(48.1351, 11.5820, 3)
    for k, v in features_forecast.items():
        print(f"   {k}: {v:.1f}")
