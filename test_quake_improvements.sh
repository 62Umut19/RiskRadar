#!/bin/bash
# Test Earthquake Model Improvements
# This script rebuilds the dataset and retrains the quake model with improved parameters

echo "============================================================"
echo "EARTHQUAKE MODEL IMPROVEMENT TEST"
echo "============================================================"
echo ""
echo "Changes:"
echo "  1. Earthquake radius: 100km → 150km"
echo "  2. Minimum magnitude: 2.5 → 2.0"
echo "  3. Class weights: balanced → {0:1, 1:30}"
echo ""
echo "============================================================"
echo ""

# Check if we're in the right directory
if [ ! -f "app/build_sensor_dataset.py" ]; then
    echo "Error: Must run from RiskRadar root directory"
    exit 1
fi

# Backup old results
echo "📦 Backing up old model results..."
if [ -f "outputs/quake_model_v4.pkl" ]; then
    mkdir -p outputs/backup_before_improvement
    cp outputs/quake_model_v4.pkl outputs/backup_before_improvement/
    cp outputs/quake_model_summary_v4.txt outputs/backup_before_improvement/
    cp outputs/quake_model_metadata_v4.json outputs/backup_before_improvement/
    cp outputs/quake_train.csv outputs/backup_before_improvement/
    cp outputs/quake_test.csv outputs/backup_before_improvement/
    echo "✓ Backed up to outputs/backup_before_improvement/"
fi

echo ""
echo "============================================================"
echo "STEP 1: Rebuild Dataset with New Label Criteria"
echo "============================================================"
echo ""

python app/build_sensor_dataset.py

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Dataset rebuild failed!"
    exit 1
fi

echo ""
echo "============================================================"
echo "STEP 2: Check New Class Distribution"
echo "============================================================"
echo ""

python3 << 'PYEOF'
import pandas as pd
import sys

try:
    train_df = pd.read_csv('outputs/quake_train.csv')
    test_df = pd.read_csv('outputs/quake_test.csv')
    
    print("TRAINING SET:")
    print(f"  Total samples: {len(train_df)}")
    print(f"  Positive (earthquakes): {train_df['label'].sum()} ({100*train_df['label'].mean():.2f}%)")
    print(f"  Negative (no earthquakes): {(train_df['label']==0).sum()} ({100*(train_df['label']==0).mean():.2f}%)")
    
    print("\nTEST SET:")
    print(f"  Total samples: {len(test_df)}")
    print(f"  Positive (earthquakes): {test_df['label'].sum()} ({100*test_df['label'].mean():.2f}%)")
    print(f"  Negative (no earthquakes): {(test_df['label']==0).sum()} ({100*(test_df['label']==0).mean():.2f}%)")
    
    if train_df['label'].sum() < 10:
        print("\n⚠️  WARNING: Very few positive samples (<10). Model may still struggle.")
    elif train_df['label'].sum() < 50:
        print("\n⚠️  WARNING: Few positive samples (<50). Expect modest improvements.")
    else:
        print("\n✓ Good number of positive samples for training.")
        
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
PYEOF

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Class distribution check failed!"
    exit 1
fi

echo ""
echo "============================================================"
echo "STEP 3: Retrain Earthquake Model"
echo "============================================================"
echo ""

python app/train_sensor_model.py --model quake

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Model training failed!"
    exit 1
fi

echo ""
echo "============================================================"
echo "STEP 4: Compare Results"
echo "============================================================"
echo ""

echo "OLD MODEL PERFORMANCE:"
if [ -f "outputs/backup_before_improvement/quake_model_summary_v4.txt" ]; then
    grep -A 6 "EVALUATION METRICS" outputs/backup_before_improvement/quake_model_summary_v4.txt
else
    echo "  (No backup found)"
fi

echo ""
echo "NEW MODEL PERFORMANCE:"
grep -A 6 "EVALUATION METRICS" outputs/quake_model_summary_v4.txt

echo ""
echo "============================================================"
echo "STEP 5: Detailed Comparison"
echo "============================================================"
echo ""

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

old_metrics = read_metrics('outputs/backup_before_improvement/quake_model_metadata_v4.json')
new_metrics = read_metrics('outputs/quake_model_metadata_v4.json')

if old_metrics and new_metrics:
    print("METRIC COMPARISON:")
    print(f"{'Metric':<15} {'Old':<10} {'New':<10} {'Change':<15}")
    print("-" * 50)
    
    metrics = ['recall', 'precision', 'f1', 'pr_auc', 'roc_auc', 'accuracy']
    for m in metrics:
        old_val = old_metrics.get(m, 0)
        new_val = new_metrics.get(m, 0)
        change = new_val - old_val
        change_str = f"+{change:.3f}" if change >= 0 else f"{change:.3f}"
        
        # Color coding
        if m in ['recall', 'precision', 'f1', 'pr_auc']:
            if change > 0.05:
                change_str = f"✅ {change_str}"
            elif change > 0:
                change_str = f"⬆️  {change_str}"
            elif change < 0:
                change_str = f"⬇️  {change_str}"
        
        print(f"{m:<15} {old_val:<10.3f} {new_val:<10.3f} {change_str:<15}")
    
    print("\n" + "="*50)
    
    # Interpretation
    if new_metrics['recall'] > 0.15:
        print("✅ EXCELLENT: Recall >15% - model is now detecting earthquakes!")
    elif new_metrics['recall'] > 0.05:
        print("✅ GOOD: Recall >5% - significant improvement over baseline")
    elif new_metrics['recall'] > 0:
        print("⚠️  MODEST: Some improvement, but recall still very low")
    else:
        print("❌ NO IMPROVEMENT: Model still not predicting earthquakes")
        print("   Consider:")
        print("   - Further lowering magnitude threshold (2.0 → 1.8)")
        print("   - Increasing radius (150km → 200km)")
        print("   - More aggressive class weights ({0:1, 1:50})")
        print("   - See QUAKE_MODEL_IMPROVEMENT_PLAN.md for details")
else:
    print("⚠️  Could not load metrics for comparison")
PYEOF

echo ""
echo "============================================================"
echo "✓ TEST COMPLETE"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Review: cat outputs/quake_model_summary_v4.txt"
echo "  2. Test predictions: python app/run_sensor_forecast.py"
echo "  3. If still poor, see: QUAKE_MODEL_IMPROVEMENT_PLAN.md"
echo ""
