@echo off
REM =============================================================================
REM RiskRadar V4 - Windows Start Script
REM =============================================================================

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║           🌍 RISKRADAR V4 - STARTING...                      ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ❌ ERROR: Docker is not running!
    echo.
    echo Please start Docker Desktop and try again.
    pause
    exit /b 1
)

REM Check if .env exists
if not exist .env (
    echo ⚠️  WARNING: .env file not found!
    echo.
    echo Creating .env from template...
    copy .env.example .env
    echo ✓ Created .env file
    echo.
    echo 📝 NEXT STEP: Edit .env and add your NASA FIRMS MAP_KEY
    echo    Get it here (2 min, free): https://firms.modaps.eosdis.nasa.gov/api/area/
    echo.
    pause
)

REM Start web viewer
echo 🚀 Starting web viewer...
docker-compose up -d viewer
echo ✓ Web viewer started at http://localhost:8080
echo.

REM Check if models exist
if not exist outputs\fire_model_v4.pkl (
    echo ⚠️  Models not found. Training models...
    echo.
    echo This may take ~60 minutes on first run.
    echo.
    pause
    
    echo 1/3 Building dataset...
    docker-compose run --rm radar python app/build_sensor_dataset.py
    
    echo 2/3 Training fire model...
    docker-compose run --rm radar python app/train_sensor_model.py --model fire
    
    echo 3/3 Training quake model...
    docker-compose run --rm radar python app/train_sensor_model.py --model quake
    
    echo ✓ Models trained successfully!
    echo.
)

REM Generate forecast
echo 🔮 Generating 72h forecast...
docker-compose run --rm radar python app/run_real_forecast.py
docker-compose run --rm radar python app/export_events.py

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║                  ✅ RISKRADAR IS READY!                      ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.
echo 🗺️  Open the map: http://localhost:8080/index.html
echo.
echo 📊 Results saved to: outputs\sensor_forecast_72h.csv
echo.
echo 🛑 To stop: stop.bat (or: docker-compose down)
echo.
pause
