#!/bin/bash
# Complete Workflow: Download Historical Data + Rebuild + Retrain Quake Model

echo "============================================================"
echo "EARTHQUAKE MODEL: EXTENDED TRAINING WITH HISTORICAL DATA"
echo "============================================================"
echo ""
echo "This script will:"
echo "  1. Download 10 years of USGS earthquake data (2015-2025)"
echo "  2. Rebuild dataset with extended time range"
echo "  3. Retrain earthquake model"
echo "  4. Compare with previous results"
echo ""
echo "Estimated time: 20-40 minutes"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# Check if we're in the right directory
if [ ! -f "app/build_sensor_dataset.py" ]; then
    echo "Error: Must run from RiskRadar root directory"
    exit 1
fi

# Backup old results
echo ""
echo "============================================================"
echo "STEP 0: Backup Current Model"
echo "============================================================"
echo ""

BACKUP_DIR="outputs/backup_before_historical_data_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ -f "outputs/quake_model_v4.pkl" ]; then
    cp outputs/quake_model_v4.pkl "$BACKUP_DIR/"
    cp outputs/quake_model_summary_v4.txt "$BACKUP_DIR/"
    cp outputs/quake_model_metadata_v4.json "$BACKUP_DIR/"
    cp outputs/quake_train.csv "$BACKUP_DIR/"
    cp outputs/quake_test.csv "$BACKUP_DIR/"
    echo "✓ Backed up to $BACKUP_DIR"
else
    echo "⚠️  No previous model found (first run?)"
fi

# Step 1: Download historical USGS data
echo ""
echo "============================================================"
echo "STEP 1: Download 10 Years of USGS Earthquake Data"
echo "============================================================"
echo ""
echo "This will download monthly data from USGS API..."
echo "Expected: 100,000-200,000 earthquake events"
echo ""

# Check if already exists
if [ -f "data/usgs_historical.csv" ]; then
    echo "⚠️  Historical data already exists: data/usgs_historical.csv"
    read -p "Re-download? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm data/usgs_historical.csv
        python app/download_historical_usgs.py --years 10
    else
        echo "Using existing data..."
    fi
else
    python app/download_historical_usgs.py --years 10
fi

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Download failed!"
    echo ""
    echo "Possible reasons:"
    echo "  - USGS API timeout or rate limit"
    echo "  - Network connection issues"
    echo ""
    echo "Solutions:"
    echo "  1. Try again (API might be temporarily down)"
    echo "  2. Manual download: See USGS_DATA_DOWNLOAD_GUIDE.md"
    echo "  3. Use smaller time range: python app/download_historical_usgs.py --years 3"
    exit 1
fi

# Check downloaded data
echo ""
echo "Verifying downloaded data..."
python3 << 'PYEOF'
import pandas as pd
import sys

try:
    df = pd.read_csv('data/usgs_historical.csv', parse_dates=['time'])
    print(f"✓ Downloaded: {len(df):,} earthquakes")
    print(f"  Date range: {df['time'].min()} to {df['time'].max()}")
    print(f"  Magnitude: M{df['mag'].min():.1f} - M{df['mag'].max():.1f}")
    
    if len(df) < 20000:
        print("\n⚠️  WARNING: Less than 20,000 events. Expected 100,000-200,000 for 10 years.")
        print("   Model improvement may be limited.")
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
PYEOF

if [ $? -ne 0 ]; then
    echo "❌ Data verification failed!"
    exit 1
fi

# Step 2: Rebuild dataset with extended time range
echo ""
echo "============================================================"
echo "STEP 2: Rebuild Dataset (2015-2025, ~10 years)"
echo "============================================================"
echo ""
echo "This will create training samples from 2015-01-01 to 2025-11-01..."
echo "Expected: 20,000-30,000 samples total"
echo ""

python app/build_sensor_dataset.py

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Dataset rebuild failed!"
    exit 1
fi

# Check new dataset
echo ""
echo "Analyzing new dataset..."
python3 << 'PYEOF'
import pandas as pd
import sys

try:
    train = pd.read_csv('outputs/quake_train.csv')
    test = pd.read_csv('outputs/quake_test.csv')
    
    print("\n" + "="*60)
    print("NEW DATASET STATISTICS")
    print("="*60)
    print(f"\nTraining Set:")
    print(f"  Samples: {len(train):,}")
    print(f"  Earthquakes: {train['label'].sum()} ({100*train['label'].mean():.2f}%)")
    print(f"  Date range: {train['target_date'].min()} to {train['target_date'].max()}")
    
    print(f"\nTest Set:")
    print(f"  Samples: {len(test):,}")
    print(f"  Earthquakes: {test['label'].sum()} ({100*test['label'].mean():.2f}%)")
    print(f"  Date range: {test['target_date'].min()} to {test['target_date'].max()}")
    
    print(f"\nTOTAL:")
    print(f"  Samples: {len(train) + len(test):,}")
    print(f"  Earthquakes: {train['label'].sum() + test['label'].sum()}")
    
    # Check if improvement
    total_quakes = train['label'].sum() + test['label'].sum()
    if total_quakes < 50:
        print("\n⚠️  WARNING: Less than 50 earthquake events total.")
        print("   Model may still have limited prediction ability.")
    elif total_quakes < 100:
        print("\n⚠️  Modest improvement expected (50-100 events).")
    else:
        print(f"\n✓ Good! {total_quakes} earthquake events should improve model.")
        
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
PYEOF

# Step 3: Retrain earthquake model
echo ""
echo "============================================================"
echo "STEP 3: Retrain Earthquake Model"
echo "============================================================"
echo ""
echo "Training Random Forest with extended historical data..."
echo ""

python app/train_sensor_model.py --model quake

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Model training failed!"
    exit 1
fi

# Step 4: Compare results
echo ""
echo "============================================================"
echo "STEP 4: Compare Before/After Performance"
echo "============================================================"
echo ""

if [ -f "$BACKUP_DIR/quake_model_summary_v4.txt" ]; then
    echo "BEFORE (limited data):"
    grep -A 6 "EVALUATION METRICS" "$BACKUP_DIR/quake_model_summary_v4.txt" || echo "(No metrics found)"
    
    echo ""
    echo "AFTER (5 years historical data):"
    grep -A 6 "EVALUATION METRICS" outputs/quake_model_summary_v4.txt || echo "(No metrics found)"
    
    echo ""
    echo "Detailed comparison:"
    
    python3 << 'PYEOF'
import json
import sys

def read_metrics(path):
    try:
        with open(path, 'r') as f:
            data = json.load(f)
            return data['metrics']
    except:
        return None

old_path = "$BACKUP_DIR/quake_model_metadata_v4.json"
new_path = "outputs/quake_model_metadata_v4.json"

old_metrics = read_metrics(old_path.replace("$BACKUP_DIR", "BACKUP_DIR"))
new_metrics = read_metrics(new_path)

if old_metrics and new_metrics:
    print("\n" + "="*70)
    print(f"{'METRIC':<15} {'BEFORE':<15} {'AFTER':<15} {'IMPROVEMENT':<20}")
    print("="*70)
    
    metrics = ['recall', 'precision', 'f1', 'pr_auc', 'roc_auc', 'accuracy']
    for m in metrics:
        old_val = old_metrics.get(m, 0)
        new_val = new_metrics.get(m, 0)
        change = new_val - old_val
        change_pct = (change / old_val * 100) if old_val > 0 else float('inf')
        
        # Format change
        if change > 0:
            if m in ['recall', 'precision', 'f1', 'pr_auc']:
                if change > 0.1:
                    indicator = "✅ GREAT"
                elif change > 0.05:
                    indicator = "✅ GOOD"
                elif change > 0:
                    indicator = "⬆️  IMPROVED"
                else:
                    indicator = "-"
            else:
                indicator = f"+{change:.3f}"
        elif change < 0:
            indicator = f"⬇️  {change:.3f}"
        else:
            indicator = "="
        
        change_str = f"{change:+.3f} ({indicator})"
        
        print(f"{m:<15} {old_val:<15.3f} {new_val:<15.3f} {change_str:<20}")
    
    print("="*70)
    print()
    
    # Overall assessment
    if new_metrics['recall'] > 0.25:
        print("🎉 EXCELLENT RESULT! Recall >25%")
        print("   The model is now detecting earthquakes reasonably well.")
    elif new_metrics['recall'] > 0.15:
        print("✅ GOOD RESULT! Recall >15%")
        print("   Significant improvement. Model is now useful for risk assessment.")
    elif new_metrics['recall'] > 0.05:
        print("⬆️  MODEST IMPROVEMENT. Recall >5%")
        print("   Better than before, but still limited predictive power.")
    else:
        print("⚠️  LIMITED IMPROVEMENT")
        print("   Model still struggles with earthquake prediction.")
        print("   This reflects the scientific challenge of short-term earthquake forecasting.")
else:
    print("Could not load metrics for comparison")
PYEOF

else
    echo "No previous results to compare (first run)"
    echo ""
    echo "NEW MODEL PERFORMANCE:"
    grep -A 6 "EVALUATION METRICS" outputs/quake_model_summary_v4.txt
fi

# Summary
echo ""
echo "============================================================"
echo "✓ WORKFLOW COMPLETE"
echo "============================================================"
echo ""
echo "Results:"
echo "  - Model: outputs/quake_model_v4.pkl"
echo "  - Summary: outputs/quake_model_summary_v4.txt"
echo "  - Backup: $BACKUP_DIR"
echo ""
echo "Next steps:"
echo "  1. Review: cat outputs/quake_model_summary_v4.txt"
echo "  2. Test predictions: python app/run_sensor_forecast.py"
echo "  3. If still poor: See QUAKE_MODEL_IMPROVEMENT_PLAN.md for advanced options"
echo ""
