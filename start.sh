#!/bin/bash

# =============================================================================
# RiskRadar V4 - Haupt-Startskript
# =============================================================================
# 
# Einfacher Start für Kommilitonen - alles in einem Befehl!
#

set -e  # Stop bei Fehler

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           🌍 RISKRADAR V4 - STARTING...                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Prüfe, ob Docker läuft
if ! docker info > /dev/null 2>&1; then
    echo "❌ ERROR: Docker is not running!"
    echo ""
    echo "Please start Docker Desktop and try again."
    exit 1
fi

# Prüfe, ob .env existiert
if [ ! -f .env ]; then
    echo "⚠️  WARNING: .env file not found!"
    echo ""
    echo "Creating .env from template..."
    cp .env.example .env
    echo "✓ Created .env file"
    echo ""
    echo "📝 NEXT STEP: Edit .env and add your NASA FIRMS MAP_KEY"
    echo "   Get it here (2 min, free): https://firms.modaps.eosdis.nasa.gov/api/area/"
    echo ""
    read -p "Press Enter after you've added your FIRMS_MAP_KEY to .env..."
fi

# Prüfe, ob Container existiert
if ! docker-compose ps | grep -q "riskradar"; then
    echo "📦 Building Docker containers (first time only, ~5 min)..."
    docker-compose build
    echo "✓ Containers built successfully!"
    echo ""
fi

# Starte Web-Viewer
echo "🚀 Starting web viewer..."
docker-compose up -d viewer
echo "✓ Web viewer started at http://localhost:8080"
echo ""

# Prüfe, ob Modelle existieren
if [ ! -f outputs/fire_model_v4.pkl ] || [ ! -f outputs/quake_model_v4.pkl ]; then
    echo "⚠️  Models not found. Training models..."
    echo ""
    echo "This may take ~60 minutes on first run (dataset building)."
    echo "But you only need to do this ONCE!"
    echo ""
    read -p "Press Enter to start training (or Ctrl+C to cancel)..."
    
    # Dataset bauen
    echo "1/3 Building dataset..."
    docker-compose run --rm radar python app/build_sensor_dataset.py
    
    # Fire Model trainieren
    echo "2/3 Training fire model..."
    docker-compose run --rm radar python app/train_sensor_model.py --model fire
    
    # Quake Model trainieren
    echo "3/3 Training quake model..."
    docker-compose run --rm radar python app/train_sensor_model.py --model quake
    
    echo "✓ Models trained successfully!"
    echo ""
fi

# Vorhersage erstellen
echo "🔮 Generating 72h forecast..."
docker-compose run --rm radar python app/run_real_forecast.py
docker-compose run --rm radar python app/export_events.py

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                  ✅ RISKRADAR IS READY!                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "🗺️  Open the map: http://localhost:8080/index.html"
echo ""
echo "📊 Results saved to: outputs/sensor_forecast_72h.csv"
echo ""
echo "🛑 To stop: ./stop.sh (or: docker-compose down)"
echo ""
