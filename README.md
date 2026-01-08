# RiskRadar 🌍⚠️

Ein Python-basiertes Machine Learning System zur **Vorhersage von Naturkatastrophen** (Waldbrände und Erdbeben) für die nächsten 72 Stunden. Nutzt echte Satelliten- und Sensordaten von NASA FIRMS und USGS.

## 🎯 Features

- **FIRMS Integration**: NASA Satellitendaten (MODIS & VIIRS) für Feuererkennung weltweit
- **USGS Integration**: Erdbebendaten aus weltweitem seismischen Netzwerk
- **Weather Data**: OpenMeteo API für historische und Forecast-Wetterdaten
- **Machine Learning**: Random Forest Classifier mit 26 Features
- **Geodaten-Analyse**: Haversine-Distanzberechnungen für präzise Entfernungsmessungen
- **72h Vorhersage**: Vorhersage für die nächsten 3 Tage
- **Interaktive Karten**: HTML-Visualisierung mit Folium
- **Docker-Ready**: Vollständig containerisiert

## 🏗️ Architektur

```
projekt-root/
├── app/
│   ├── run_real_forecast.py      # Hauptskript für Vorhersagen
│   ├── train_sensor_model.py     # Modell-Training
│   ├── config.py                  # Konfiguration
│   ├── firms_client.py            # NASA FIRMS API Client
│   ├── usgs_client.py             # USGS API Client
│   ├── openmeteo_client.py        # OpenMeteo API Client
│   ├── sensor_features.py         # Feature Engineering
│   ├── sensor_labels.py           # Label-Generierung
│   ├── geo_utils.py               # Geodaten-Berechnungen
│   └── requirements.txt           # Python-Abhängigkeiten
├── data/
│   ├── standorte.csv              # Standort-Input
│   └── cache/                     # API-Cache
├── outputs/
│   ├── fire_model_v4.pkl          # Trainiertes Fire Model
│   ├── quake_model_v4.pkl         # Trainiertes Quake Model
│   ├── real_forecast_72h.csv      # Vorhersage-Ergebnisse
│   └── real_forecast_map.html     # Interaktive Karte
├── Dockerfile
├── docker-compose.yml
└── .env                           # Konfiguration
```
## 🚀 Quick Start

### Voraussetzungen

- **Python 3.11** (empfohlen, Python 3.13 wird noch nicht unterstützt) und **Docker**
- Internet-Verbindung für APIs (FIRMS, USGS, OpenMeteo)
- **NASA FIRMS Daten** (siehe Daten-Setup unten)

---

## 📥 Daten-Setup (WICHTIG!)

### Schritt 1: NASA FIRMS API Key holen

1. Besuche: https://firms.modaps.eosdis.nasa.gov/api/area/
2. Registriere dich kostenlos
3. Kopiere deinen `MAP_KEY`

### Schritt 2: API Key konfigurieren

Erstelle eine `.env` Datei im Projekt-Root:

```bash
# .env Datei erstellen
cp .env.example .env

# Dann deinen MAP_KEY eintragen:
FIRMS_MAP_KEY=dein_map_key_hier
```

### Schritt 3: FIRMS Daten herunterladen

**Manuelle Downloads (2 Downloads erforderlich)**

**🔥 Download 1: FIRMS 2024 Archive**
- **Link:** https://firms.modaps.eosdis.nasa.gov/download/
- **Auswahl:** `Create New Request`  → `World`  → `MODIS` → `Timeframe 2024-01-01 - 2024-12-31` → `CSV` → `Submit`
- **Dateiname:** `fire_archive_M-C61_XXXXXX.csv`
- **Speicherort:** `FIRMS_2024_ARCHIVE/`
- **Zweck:** Historische Trainingsdaten (ganzes Jahr 2024)

**🔥 Download 2: FIRMS 2025 NRT (enthält 2 CSV-Dateien)**
- **Link:** https://firms.modaps.eosdis.nasa.gov/download/
- **Auswahl:** `Create New Request`  → `World`  → `MODIS` → `Timeframe 2025-01-01 - 2025-12-31` → `CSV` → `Submit`
- **Enthalten:**
  - `fire_archive_M-C61_XXXXXX.csv` - Archivdaten 2025
  - `fire_nrt_M-C61_XXXXXX.csv` - Letzte 7 Tage (NRT)
- **Speicherort:** Beide in `FIRMS_2025_NRT/` entpacken
- **Zweck:** Aktuelle Daten für Vorhersagen

**Verzeichnisstruktur nach Download:**
```
RiskRadar/
├── FIRMS_2024_ARCHIVE/
│   └── fire_archive_M-C61_XXXXXX.csv
├── FIRMS_2025_NRT/
│   ├── fire_nrt_M-C61_XXXXXX.csv
│   └── fire_archive_M-C61_XXXXXX.csv
└── .env                                  (mit deinem MAP_KEY)
```

**⚠️ Hinweis:** Diese Dateien sind zu groß für Git und müssen manuell heruntergeladen werden. Sie sind bereits in der `.gitignore`.

### Schritt 4: Dataset bauen (einmalig)

```bash
python app/build_sensor_dataset.py
```

Dies erstellt die Trainings- und Test-Datasets aus den FIRMS-Daten.

---

## 🐳 Installation & Start

### Option 1: Docker (Empfohlen)

```bash
# 1. Projekt klonen/herunterladen
cd RiskRadar

# 2. Daten-Setup (siehe oben!)
python app/update_firms_data.py

# 3. Container starten (baut automatisch Dataset + trainiert Modelle)
./start.sh  # Linux/Mac
# ODER
start.bat   # Windows

# 4. Ergebnisse ansehen
open outputs/real_forecast_map.html
```

**🎯 Für Präsentationen:**
```bash
# Vorbereitung (1x durchführen):
docker-compose build
docker-compose run --rm radar python app/run_real_forecast.py

# Am Präsentationstag (3 Sekunden!):
docker-compose up -d viewer
open http://localhost:8080/sensor_forecast_map.html
```

**Weitere Docker-Befehle:**
```bash
docker-compose up -d          # Im Hintergrund starten
docker-compose logs -f radar  # Logs anschauen
docker-compose down           # Stoppen
./update.sh                   # System aktualisieren (Mac/Linux)
./stop.sh                     # System stoppen (Mac/Linux)
```

### Option 2: Lokale Python-Installation

```bash
# 1. Virtual Environment erstellen
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 2. Dependencies installieren
pip install -r app/requirements.txt

# 3. Modell trainieren (einmalig)
cd app
python train_sensor_model.py

# 4. Vorhersage ausführen
python run_real_forecast.py
```

## ⚙️ Konfiguration

Alle Einstellungen werden über die `.env`-Datei gesteuert:

```bash
# FIRMS und USGS sind öffentlich zugänglich

# Risiko-Parameter
FIRE_RADIUS_KM=50          # Radius für Feuer-Events
QUAKE_RADIUS_KM=100        # Radius für Erdbeben-Events
FIRE_MIN_MAGNITUDE=4.0     # Minimum Magnitude für Erdbeben

# Features
LOOKBACK_DAYS=7            # Historische Daten für Features
FORECAST_HOURS=72          # Vorhersage-Horizont (3 Tage)
```

## 📊 Eingabedaten

Die Datei `data/standorte.csv` enthält die zu überwachenden Standorte:

```csv
name,lat,lon
Los Angeles,34.0522,-118.2437
San Francisco,37.7749,-122.4194
Anchorage,61.2181,-149.9003
...
```

## 🧮 Machine Learning Pipeline

### Training


1. **Daten sammeln**: FIRMS (Feuer) und USGS (Erdbeben) von 2020-2024
2. **Features berechnen**: 26 Features aus historischen Daten (7-30 Tage vor Event)
3. **Labels erstellen**: Schaue 72h in Zukunft - gab es ein Event?
4. **Modell trainieren**: Random Forest mit Class Balancing
5. **Evaluation**: Precision, Recall, F1-Score, ROC-AUC

**Modell-Ergebnisse:**
- Fire Model: F1=0.62, Precision=0.58, Recall=0.67, AUC=0.73
- Quake Model: F1=0.58, Precision=0.55, Recall=0.61, AUC=0.70

### Vorhersage

1. **Modell laden**: `fire_model_v4.pkl` und `quake_model_v4.pkl`
2. **Aktuelle Daten**: Letzte 7-30 Tage von APIs holen
3. **Features berechnen**: Gleiche 26 Features wie beim Training
4. **Vorhersage**: Modell gibt Wahrscheinlichkeit (0-100%)
5. **Klassifizierung**: >50% = HIGH RISK, ≤50% = LOW RISK

## 📈 Outputs

### 1. `real_forecast_72h.csv`
Vorhersage-Ergebnisse für jeden Standort:

| location      | latitude | longitude | fire_risk | fire_probability | quake_risk | quake_probability |
|---------------|----------|-----------|-----------|------------------|------------|-------------------|
| Los Angeles   | 34.05    | -118.24   | HIGH      | 0.78             | LOW        | 0.23              |
| San Francisco | 37.77    | -122.42   | LOW       | 0.12             | HIGH       | 0.89              |

### 2. `real_forecast_map.html`
Interaktive Folium-Karte mit:
- Standort-Markern (Rot=HIGH RISK, Grün=LOW RISK)
- Popups mit Fire/Quake Wahrscheinlichkeiten
- Zoom und Pan-Funktionalität

### 3. Trainierte Modelle
- `fire_model_v4.pkl`: Random Forest für Feuer-Vorhersage
- `quake_model_v4.pkl`: Random Forest für Erdbeben-Vorhersage
- `*_metadata_v4.json`: Modell-Informationen und Metriken

## 🔍 Logging

Das System loggt alle wichtigen Schritte:

```
2024-12-30 10:00:00 - INFO - RiskRadar V4 - Real Forecast Starting
2024-12-30 10:00:01 - INFO - Loaded 10 sites from standorte.csv
2024-12-30 10:00:02 - INFO - Loading models: fire_model_v4.pkl, quake_model_v4.pkl
2024-12-30 10:00:03 - INFO - Fetching FIRMS data (last 7 days)...
2024-12-30 10:00:05 - INFO - Fetching USGS data (last 30 days)...
2024-12-30 10:00:07 - INFO - Computing features for 10 sites...
2024-12-30 10:00:10 - INFO - ✓ Forecast complete! Results saved to outputs/
```

## 🧪 Entwicklung

### Tests ausführen

```bash
cd app
python sensor_features.py  # Test Feature Engineering
python sensor_labels.py    # Test Label Generation
```

### Code-Qualität

```bash
# Linting
pylint app/

# Type Checking
mypy app/

# Formatting
black app/
```
## 🔧 Troubleshooting

### Problem: Docker läuft nicht
**Lösung:** Docker Desktop öffnen und warten, bis der Wal-Icon grün ist

### Problem: Port 8080 belegt
**Lösung:** In `docker-compose.yml` den Port ändern (z.B. 9090:80)

### Problem: "Module not found"
```bash
# Stellen Sie sicher, dass Sie im Virtual Environment sind
source venv/bin/activate
pip install -r app/requirements.txt
```

### Problem: "Permission denied" bei Scripts
```bash
chmod +x start.sh stop.sh update.sh
```

### Problem: FIRMS-Daten veraltet
**Lösung:** Siehe `FIRMS_UPDATE_ANLEITUNG.md` für Anleitung zum Aktualisieren der NASA-Daten

## 📝 Best Practices

1. **Modell regelmäßig neu trainieren**: Mit neuen Daten alle 6-12 Monate
2. **Cache nutzen**: Vermeidet unnötige API-Requests
3. **Validierung**: System validiert Eingaben automatisch
4. **Logging beachten**: Alle Events werden geloggt
5. **Docker nutzen**: Garantiert reproduzierbare Umgebung

## 🎓 ML-Details

### Modell-Auswahl: Warum Random Forest?

1. **Robust**: Funktioniert gut mit tabellarischen Daten
2. **Feature Importance**: Zeigt welche Features wichtig sind
3. **Kein Overfitting**: Ensemble-Methode reduziert Overfitting
4. **Schnell**: Training und Inferenz in Sekunden
5. **Probabilistisch**: Gibt Wahrscheinlichkeiten aus

### Feature Engineering (26 Features)

```python
# Wetter-Features (7): Temperatur, Luftfeuchtigkeit, Wind, Regen
temp_mean, temp_max, humidity_mean, humidity_min, wind_max, rain_total, dry_days

# Fire History (8): Anzahl, Intensität, Distanz, Tage seit letztem Event
fires_7d_count, fires_30d_count, fire_max_brightness_7d, fire_avg_brightness_7d,
fire_max_frp_7d, fire_avg_frp_7d, fires_persistent_days, days_since_last_fire

# Quake History (7): Anzahl, Magnitude, Trend, Tage seit letztem Event
quakes_7d_count, quakes_30d_count, quake_max_mag_30d, quake_avg_mag_30d,
quakes_5plus_count, seismic_trend, days_since_last_quake

# Temporal & Geo (4): Ort und Jahreszeit
latitude, longitude, month, season
```

### Training-Pipeline

1. **Datensammlung**: FIRMS + USGS + Weather (2020-2024)
2. **Feature Engineering**: 26 Features pro Sample
3. **Label Generation**: 72h Look-ahead (0 oder 1)
4. **Train/Test Split**: 80/20 zeitbasiert
5. **Class Balancing**: Gewichtung für unbalancierte Klassen
6. **Model Training**: Random Forest (100 Bäume, max_depth=10)
7. **Evaluation**: Precision, Recall, F1, ROC-AUC
8. **Speichern**: .pkl Datei + Metadata

### Evaluation-Metriken

- **Precision**: Von allen Warnungen, wie viele waren richtig?
- **Recall**: Von allen echten Events, wie viele erkannt?
- **F1-Score**: Harmonischer Mittelwert (Balance)
- **ROC-AUC**: Gesamtperformance (0.5=Zufall, 1.0=Perfekt)

**Unsere Ergebnisse:**
- Fire Model: F1=0.62, AUC=0.73 ✅
- Quake Model: F1=0.58, AUC=0.70 ✅

## 🚀 Erweiterungsmöglichkeiten

1. **Mehr Features**: Topografie, Vegetation, historische Brand-Karten
2. **Deep Learning**: LSTM für Zeitreihen-Analyse
3. **Ensemble**: Kombiniere mehrere Modelle
4. **Real-time API**: REST API für Live-Vorhersagen
5. **Mobile App**: Push-Notifications bei HIGH RISK
6. **Multi-Region**: Modelle für verschiedene Kontinente

## 📄 Lizenz

Dieses Projekt wurde für akademische Zwecke entwickelt (FOM - Business Analytics).

**Datenquellen:**
- NASA FIRMS (Public Domain)
- USGS Earthquake Catalog (Public Domain)
- OpenMeteo (Free for non-commercial use)


