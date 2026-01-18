"""
Configuration module for RiskRadar V4 - Sensor-based forecasting.
"""
import os
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)


class Config:
    """Central configuration class for RiskRadar V4."""
    
    # Risk Parameters
    FIRE_RADIUS_KM = float(os.getenv("FIRE_RADIUS_KM", "50"))
    QUAKE_RADIUS_KM = float(os.getenv("QUAKE_RADIUS_KM", "100"))
    MIN_QUAKE_MAGNITUDE = float(os.getenv("MIN_QUAKE_MAGNITUDE", "4.0"))
    
    # Feature Engineering
    LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "7"))
    FORECAST_HOURS = int(os.getenv("FORECAST_HOURS", "72"))
    OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY")
    
    # File Paths
    DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
    OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "outputs")
    CACHE_DIR = os.path.join(DATA_DIR, "cache")
    
    STANDORTE_FILE = os.path.join(DATA_DIR, "standorte.csv")
    
    # FIRMS Data Paths
    FIRMS_2024_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "FIRMS_2024_ARCHIVE")
    FIRMS_2025_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "FIRMS_2025_NRT")

    FIRMS_ARCHIVE_2024_FILE = os.path.join(FIRMS_2024_DIR, "fire_archive_M-C61.csv")
    FIRMS_ARCHIVE_2025_FILE = os.path.join(FIRMS_2025_DIR, "fire_archive_M-C61.csv")
    FIRMS_NRT_2025_FILE = os.path.join(FIRMS_2025_DIR, "fire_nrt_M-C61.csv")
    
    # Output Files
    FIRE_MODEL_FILE = os.path.join(OUTPUT_DIR, "fire_model_v4.pkl")
    QUAKE_MODEL_FILE = os.path.join(OUTPUT_DIR, "quake_model_v4.pkl")
    FORECAST_CSV = os.path.join(OUTPUT_DIR, "real_forecast_72h.csv")
    FORECAST_MAP = os.path.join(OUTPUT_DIR, "real_forecast_map.html")
    
    @classmethod
    def validate(cls) -> bool:
        """Validate configuration and create necessary directories."""
        try:
            # Create directories if they don't exist
            os.makedirs(cls.DATA_DIR, exist_ok=True)
            os.makedirs(cls.OUTPUT_DIR, exist_ok=True)
            os.makedirs(cls.CACHE_DIR, exist_ok=True)
            
            # Validate standorte file exists
            if not os.path.exists(cls.STANDORTE_FILE):
                logger.warning(f"Standorte file not found: {cls.STANDORTE_FILE}")
                logger.warning("Creating default standorte.csv...")
                cls._create_default_standorte()
            
            # Validate numeric parameters
            if cls.FIRE_RADIUS_KM <= 0:
                logger.error("FIRE_RADIUS_KM must be positive")
                return False
            
            if cls.QUAKE_RADIUS_KM <= 0:
                logger.error("QUAKE_RADIUS_KM must be positive")
                return False
            
            if cls.LOOKBACK_DAYS <= 0:
                logger.error("LOOKBACK_DAYS must be positive")
                return False
            
            logger.info("Configuration validated successfully")
            return True
            
        except Exception as e:
            logger.error(f"Configuration validation failed: {e}")
            return False
    
    @classmethod
    def _create_default_standorte(cls):
        """Create a default standorte.csv file."""
        default_content = """name,lat,lon
Los Angeles,34.0522,-118.2437
San Francisco,37.7749,-122.4194
Seattle,47.6062,-122.3321
Anchorage,61.2181,-149.9003
Tokyo,35.6762,139.6503
"""
        with open(cls.STANDORTE_FILE, 'w') as f:
            f.write(default_content)
        logger.info(f"Created default standorte.csv at {cls.STANDORTE_FILE}")
    
    @classmethod
    def log_config(cls):
        """Log current configuration (for debugging)."""
        logger.info("=" * 60)
        logger.info("RiskRadar V4 Configuration")
        logger.info("=" * 60)
        logger.info(f"Fire Radius: {cls.FIRE_RADIUS_KM} km")
        logger.info(f"Quake Radius: {cls.QUAKE_RADIUS_KM} km")
        logger.info(f"Min Quake Magnitude: {cls.MIN_QUAKE_MAGNITUDE}")
        logger.info(f"Lookback Days: {cls.LOOKBACK_DAYS}")
        logger.info(f"Forecast Hours: {cls.FORECAST_HOURS}")
        logger.info("=" * 60)

