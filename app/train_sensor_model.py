#!/usr/bin/env python3
"""
Training Script für Sensor-basierte RiskRadar V4 Modelle

Trainiert separate Modelle:
- Fire Risk Model (FIRMS-based)
- Quake Risk Model (USGS-based)

Features:
- Time-based evaluation (kein random split)
- Multiple Metriken (Recall, Precision, F1, PR-AUC)
- Feature Importance Analyse
- Hyperparameter Tuning

Author: RiskRadar Team
Date: 2025-12-23
"""

import pandas as pd
import numpy as np
from pathlib import Path
import logging
import argparse
import joblib
from datetime import datetime

# ML imports
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score,
    precision_recall_curve,
    auc,
    recall_score,
    precision_score,
    f1_score
)

# Local imports
from config import Config

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== CONFIGURATION ====================

OUTPUT_DIR = Path(Config.OUTPUT_DIR)

# Model Hyperparameters
RANDOM_FOREST_PARAMS = {
    'n_estimators': 200,
    'max_depth': 15,
    'min_samples_split': 5,
    'min_samples_leaf': 2,
    'max_features': 'sqrt',
    'random_state': 42,
    'n_jobs': -1,
    'class_weight': 'balanced'  # Will be overridden for specific models
}

# Fire-specific: Aggressive weighting to improve Recall (currently 32.3%)
FIRE_CLASS_WEIGHT = {0: 1, 1: 10}  # Penalize missing fires 10x more

# Earthquake-specific: Moderate weighting to balance Precision vs Recall
QUAKE_CLASS_WEIGHT = {0: 1, 1: 15}  # Reduced from 30 to improve Precision

# Prediction Thresholds (Quick Win #2: Lower threshold for better Recall)
FIRE_THRESHOLD = 0.3   # Lower than default 0.5 to catch more fires
QUAKE_THRESHOLD = 0.4  # Slightly lower to balance Precision/Recall


# ==================== DATA LOADING ====================

def load_train_test_data(model_type: str) -> tuple:
    """
    Load train/test datasets.
    
    Args:
        model_type: 'fire' or 'quake'
        
    Returns:
        (X_train, y_train, X_test, y_test, feature_names)
    """
    logger.info(f"Loading {model_type.upper()} datasets...")
    
    train_path = OUTPUT_DIR / f'{model_type}_train.csv'
    test_path = OUTPUT_DIR / f'{model_type}_test.csv'
    
    if not train_path.exists():
        raise FileNotFoundError(f"Training data not found: {train_path}")
    if not test_path.exists():
        raise FileNotFoundError(f"Test data not found: {test_path}")
    
    train_df = pd.read_csv(train_path)
    test_df = pd.read_csv(test_path)
    
    logger.info(f"  Train: {len(train_df)} samples")
    logger.info(f"  Test:  {len(test_df)} samples")
    
    # Feature columns (alles außer Metadata)
    meta_cols = ['site_name', 'target_date', 'label', 'lat', 'lon',
                 'label_meta_detections', 'label_meta_max_brightness',
                 'label_meta_events', 'label_meta_max_mag']
    
    feature_cols = [c for c in train_df.columns if c not in meta_cols]
    
    logger.info(f"  Features: {len(feature_cols)}")
    
    # Train Set
    X_train = train_df[feature_cols].values
    y_train = train_df['label'].values
    
    # Test Set
    X_test = test_df[feature_cols].values
    y_test = test_df['label'].values
    
    # Class distribution
    logger.info(f"\n  Train Label Distribution:")
    logger.info(f"    Positive: {y_train.sum()} ({y_train.mean()*100:.1f}%)")
    logger.info(f"    Negative: {(y_train==0).sum()} ({(y_train==0).mean()*100:.1f}%)")
    logger.info(f"  Test Label Distribution:")
    logger.info(f"    Positive: {y_test.sum()} ({y_test.mean()*100:.1f}%)")
    logger.info(f"    Negative: {(y_test==0).sum()} ({(y_test==0).mean()*100:.1f}%)")
    
    return X_train, y_train, X_test, y_test, feature_cols


# ==================== MODEL TRAINING ====================

def train_model(X_train: np.ndarray, y_train: np.ndarray, model_type: str = 'fire') -> RandomForestClassifier:
    """
    Train Random Forest Classifier with model-specific parameters.
    
    Args:
        X_train: Training Features
        y_train: Training Labels
        model_type: 'fire' or 'quake' - determines class weights
        
    Returns:
        Trained model
    """
    logger.info("\nTraining Random Forest Classifier...")
    
    # Use model-specific class weights
    params = RANDOM_FOREST_PARAMS.copy()
    if model_type == 'quake':
        params['class_weight'] = QUAKE_CLASS_WEIGHT
        logger.info(f"  Using quake-specific class weights: {QUAKE_CLASS_WEIGHT}")
    elif model_type == 'fire':
        params['class_weight'] = FIRE_CLASS_WEIGHT
        logger.info(f"  Using fire-specific class weights: {FIRE_CLASS_WEIGHT}")
    
    logger.info(f"  Hyperparameters: {params}")
    
    model = RandomForestClassifier(**params)
    model.fit(X_train, y_train)
    
    logger.info("✓ Training complete!")
    
    return model


# ==================== EVALUATION ====================

def evaluate_model(
    model: RandomForestClassifier,
    X_test: np.ndarray,
    y_test: np.ndarray,
    feature_names: list,
    model_type: str
) -> dict:
    """
    Evaluiert Modell auf Test Set.
    
    Args:
        model: Trainiertes Modell
        X_test: Test Features
        y_test: Test Labels
        feature_names: Liste der Feature-Namen
        model_type: 'fire' oder 'quake'
        
    Returns:
        Dictionary mit Metriken
    """
    logger.info("\n" + "="*60)
    logger.info("MODEL EVALUATION")
    logger.info("="*60)
    
    # Get model-specific threshold
    threshold = FIRE_THRESHOLD if model_type == 'fire' else QUAKE_THRESHOLD
    logger.info(f"\nUsing custom threshold: {threshold} (default is 0.5)")
    
    # Predictions with custom threshold (Quick Win #2)
    y_proba = model.predict_proba(X_test)[:, 1]  # Probability für Klasse 1
    y_pred = (y_proba >= threshold).astype(int)  # Custom threshold instead of 0.5
    
    # Also get default predictions for comparison
    y_pred_default = model.predict(X_test)
    
    # 1. Confusion Matrix
    logger.info("\n1. Confusion Matrix (Custom Threshold):")
    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()
    
    logger.info(f"\n              Predicted")
    logger.info(f"              0      1")
    logger.info(f"    Actual 0  {tn:4d}  {fp:4d}")
    logger.info(f"           1  {fn:4d}  {tp:4d}")
    
    # Show comparison with default threshold
    recall_custom = recall_score(y_test, y_pred)
    precision_custom = precision_score(y_test, y_pred)
    recall_default = recall_score(y_test, y_pred_default)
    precision_default = precision_score(y_test, y_pred_default)
    
    logger.info(f"\n  Comparison (Custom {threshold} vs Default 0.5):")
    logger.info(f"    Recall:    {recall_custom:.3f} vs {recall_default:.3f} ({recall_custom-recall_default:+.3f})")
    logger.info(f"    Precision: {precision_custom:.3f} vs {precision_default:.3f} ({precision_custom-precision_default:+.3f})")
    
    # 2. Classification Report
    logger.info("\n2. Classification Report:")
    report = classification_report(y_test, y_pred, target_names=['No Event', 'Event'])
    logger.info(f"\n{report}")
    
    # 3. Key Metrics
    recall = recall_custom
    precision = precision_custom
    f1 = f1_score(y_test, y_pred)
    
    logger.info("\n3. Key Metrics:")
    logger.info(f"  Recall:    {recall:.3f}  (Von allen echten Events: Wie viele erkannt?)")
    logger.info(f"  Precision: {precision:.3f}  (Von allen Vorhersagen: Wie viele richtig?)")
    logger.info(f"  F1-Score:  {f1:.3f}  (Harmonic Mean von Recall & Precision)")
    
    # 4. PR-AUC (wichtig bei Imbalance!)
    precision_curve, recall_curve, _ = precision_recall_curve(y_test, y_proba)
    pr_auc = auc(recall_curve, precision_curve)
    
    logger.info(f"  PR-AUC:    {pr_auc:.3f}  (Precision-Recall AUC, gut für Imbalance)")
    
    # 5. ROC-AUC (optional)
    if len(np.unique(y_test)) > 1:  # Nur wenn beide Klassen im Test Set
        roc_auc = roc_auc_score(y_test, y_proba)
        logger.info(f"  ROC-AUC:   {roc_auc:.3f}  (Standard AUC)")
    else:
        roc_auc = None
        logger.warning("  ROC-AUC:   N/A (only one class in test set)")
    
    # 6. Feature Importance
    logger.info("\n4. Top 10 Feature Importances:")
    feature_importance = pd.DataFrame({
        'feature': feature_names,
        'importance': model.feature_importances_
    }).sort_values('importance', ascending=False)
    
    for idx, row in feature_importance.head(10).iterrows():
        logger.info(f"  {row['feature']:30s}: {row['importance']:.4f}")
    
    # 7. Baseline Comparison
    baseline_accuracy = max((y_test == 0).mean(), (y_test == 1).mean())
    model_accuracy = (y_pred == y_test).mean()
    
    logger.info(f"\n5. Baseline Comparison:")
    logger.info(f"  Majority Class Baseline: {baseline_accuracy:.3f}")
    logger.info(f"  Model Accuracy:          {model_accuracy:.3f}")
    logger.info(f"  Improvement:             {(model_accuracy - baseline_accuracy):.3f}")
    
    # Return metrics
    metrics = {
        'confusion_matrix': cm.tolist(),
        'recall': float(recall),
        'precision': float(precision),
        'f1': float(f1),
        'pr_auc': float(pr_auc),
        'roc_auc': float(roc_auc) if roc_auc else None,
        'accuracy': float(model_accuracy),
        'baseline_accuracy': float(baseline_accuracy),
        'feature_importance': feature_importance.to_dict('records')
    }
    
    return metrics


# ==================== SAVE MODEL ====================

def save_model_and_metadata(
    model: RandomForestClassifier,
    metrics: dict,
    feature_names: list,
    model_type: str
):
    """
    Save model and metadata.
    
    Args:
        model: Trained model
        metrics: Evaluation metrics
        feature_names: Feature names
        model_type: 'fire' or 'quake'
    """
    logger.info("\n" + "="*60)
    logger.info("SAVING MODEL")
    logger.info("="*60)
    
    # Save model
    model_path = OUTPUT_DIR / f'{model_type}_model_v4.pkl'
    joblib.dump(model, model_path)
    logger.info(f"\n✓ Model saved: {model_path}")
    
    # Metadata speichern
    metadata = {
        'model_type': model_type,
        'training_date': datetime.now().isoformat(),
        'hyperparameters': RANDOM_FOREST_PARAMS,
        'feature_names': feature_names,
        'metrics': metrics
    }
    
    metadata_path = OUTPUT_DIR / f'{model_type}_model_metadata_v4.json'
    
    import json
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    logger.info(f"✓ Metadata saved: {metadata_path}")
    
    # Human-readable Summary
    summary_path = OUTPUT_DIR / f'{model_type}_model_summary_v4.txt'
    
    with open(summary_path, 'w') as f:
        f.write("="*60 + "\n")
        f.write(f"{model_type.upper()} RISK MODEL V4 - TRAINING SUMMARY\n")
        f.write("="*60 + "\n\n")
        
        f.write(f"Training Date: {metadata['training_date']}\n")
        f.write(f"Model Type: {model_type}\n\n")
        
        f.write("ARCHITECTURE:\n")
        f.write(f"  Algorithm: Random Forest Classifier\n")
        f.write(f"  n_estimators: {RANDOM_FOREST_PARAMS['n_estimators']}\n")
        f.write(f"  max_depth: {RANDOM_FOREST_PARAMS['max_depth']}\n")
        f.write(f"  class_weight: {RANDOM_FOREST_PARAMS['class_weight']}\n\n")
        
        f.write("FEATURES:\n")
        f.write(f"  Total: {len(feature_names)}\n")
        for fname in feature_names:
            f.write(f"    - {fname}\n")
        f.write("\n")
        
        f.write("EVALUATION METRICS (Test Set):\n")
        f.write(f"  Recall:    {metrics['recall']:.3f}\n")
        f.write(f"  Precision: {metrics['precision']:.3f}\n")
        f.write(f"  F1-Score:  {metrics['f1']:.3f}\n")
        f.write(f"  PR-AUC:    {metrics['pr_auc']:.3f}\n")
        if metrics['roc_auc']:
            f.write(f"  ROC-AUC:   {metrics['roc_auc']:.3f}\n")
        f.write(f"  Accuracy:  {metrics['accuracy']:.3f}\n\n")
        
        f.write("CONFUSION MATRIX:\n")
        cm = metrics['confusion_matrix']
        f.write(f"              Predicted\n")
        f.write(f"              0      1\n")
        f.write(f"    Actual 0  {cm[0][0]:4d}  {cm[0][1]:4d}\n")
        f.write(f"           1  {cm[1][0]:4d}  {cm[1][1]:4d}\n\n")
        
        f.write("TOP 10 FEATURES:\n")
        for feat_dict in metrics['feature_importance'][:10]:
            f.write(f"  {feat_dict['feature']:30s}: {feat_dict['importance']:.4f}\n")
    
    logger.info(f"✓ Summary saved: {summary_path}")


# ==================== MAIN ====================

def main():
    """Main Training Pipeline."""
    
    parser = argparse.ArgumentParser(description='Train RiskRadar V4 Sensor-Based Model')
    parser.add_argument('--model', type=str, required=True, choices=['fire', 'quake'],
                        help='Model type: fire or quake')
    
    args = parser.parse_args()
    model_type = args.model
    
    logger.info("="*80)
    logger.info(f"RISKRADAR V4 - {model_type.upper()} RISK MODEL TRAINING")
    logger.info("="*80)
    
    # 1. Load Data
    logger.info("\n1. Loading Data...")
    X_train, y_train, X_test, y_test, feature_names = load_train_test_data(model_type)
    
    # 2. Train Model
    logger.info("\n2. Training Model...")
    model = train_model(X_train, y_train, model_type)
    
    # 3. Evaluate Model
    logger.info("\n3. Evaluating Model...")
    metrics = evaluate_model(model, X_test, y_test, feature_names, model_type)
    
    # 4. Save Model
    logger.info("\n4. Saving Model...")
    save_model_and_metadata(model, metrics, feature_names, model_type)
    
    # Done
    logger.info("\n" + "="*80)
    logger.info(f"✓ {model_type.upper()} MODEL TRAINING COMPLETE!")
    logger.info("="*80)
    logger.info(f"\nModel saved to: {OUTPUT_DIR / f'{model_type}_model_v4.pkl'}")
    logger.info(f"\nNext Steps:")
    logger.info(f"  - Review summary: {OUTPUT_DIR / f'{model_type}_model_summary_v4.txt'}")
    if model_type == 'fire':
        logger.info(f"  - Train Quake Model: python train_sensor_model.py --model quake")
    else:
        logger.info(f"  - Run Predictions: python run_sensor_forecast.py")


if __name__ == "__main__":
    import sys
    try:
        main()
    except Exception as e:
        logger.error(f"\nERROR: {e}", exc_info=True)
        sys.exit(1)
