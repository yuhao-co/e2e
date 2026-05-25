#!/usr/bin/env python3

"""
Bug Classification and Priority Prediction Model Training

Trains ML models to:
1. Classify bugs into categories
2. Predict bug severity/priority
3. Suggest bug fixes

Usage:
  python3 scripts/train-bug-classification-model.py --data data/bug-detection/training-data.jsonl
  python3 scripts/train-bug-classification-model.py --evaluate
  python3 scripts/train-bug-classification-model.py --predict < bug_data.json
"""

import json
import argparse
import pickle
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Any
import sys

# Check if required packages are available
try:
    import numpy as np
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import LabelEncoder
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
    from sklearn.metrics import (
        classification_report,
        confusion_matrix,
        accuracy_score,
        f1_score,
        precision_score,
        recall_score,
    )
    from sklearn.feature_extraction.text import TfidfVectorizer
    import pandas as pd
except ImportError as e:
    print(f"Error: Required package not found: {e}")
    print("Install with: pip install scikit-learn pandas numpy")
    sys.exit(1)


class BugClassificationModel:
    """ML model for bug classification and priority prediction"""

    def __init__(self, model_dir: str = "models/bug-classification"):
        self.model_dir = Path(model_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)

        self.severity_model = None
        self.category_model = None
        self.text_vectorizer = None
        self.label_encoders = {}

    def load_training_data(self, data_file: str) -> pd.DataFrame:
        """Load training data from JSONL file"""
        records = []
        with open(data_file, "r") as f:
            for line in f:
                if line.strip():
                    records.append(json.loads(line))

        df = pd.DataFrame(records)
        print(f"✓ Loaded {len(df)} training records")
        return df

    def extract_features(self, df: pd.DataFrame) -> Tuple[np.ndarray, Dict]:
        """Extract features from bug data"""
        features = []

        for _, row in df.iterrows():
            bug_data = row["bugData"]
            features_dict = row["features"]

            # Basic features
            feature_vector = [
                # Severity mapping
                {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(bug_data.get("severity"), 3),
                # Category mapping
                self._encode_category(bug_data.get("category")),
                # Evidence size
                features_dict.get("evidenceSize", 0),
                # Description length
                features_dict.get("descriptionLength", 0),
                # Total bugs in run
                features_dict.get("totalBugsInRun", 1),
                # Platform (desktop=0, mobile=1)
                1 if features_dict.get("platform") == "mobile" else 0,
                # Locale (grouped by region)
                self._encode_locale(features_dict.get("locale", "en-US")),
            ]

            features.append(feature_vector)

        return np.array(features), features_dict

    def _encode_category(self, category: str) -> int:
        """Encode bug category to integer"""
        categories = {"i18n": 0, "error": 1, "accessibility": 2, "ui": 3, "performance": 4, "functional": 5}
        return categories.get(category, 5)

    def _encode_locale(self, locale: str) -> int:
        """Encode locale to region code"""
        locale_map = {
            "en-US": 0,
            "en-GB": 1,
            "id-ID": 2,
            "zh-CN": 3,
            "vi-VN": 4,
            "th-TH": 5,
            "ko-KR": 6,
            "ja-JP": 7,
        }
        return locale_map.get(locale, 8)

    def train_severity_model(self, X: np.ndarray, y: List[str]):
        """Train model to predict bug severity"""
        print("\n📚 Training severity classification model...")

        # Encode labels
        encoder = LabelEncoder()
        y_encoded = encoder.fit_transform(y)
        self.label_encoders["severity"] = encoder

        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
        )

        # Train model
        self.severity_model = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
        self.severity_model.fit(X_train, y_train)

        # Evaluate
        y_pred = self.severity_model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred, average="weighted")

        print(f"  Accuracy: {accuracy:.3f}")
        print(f"  F1-Score: {f1:.3f}")

        print("\nClassification Report:")
        print(
            classification_report(
                y_test, y_pred, target_names=encoder.classes_
            )
        )

        # Save model
        self._save_model(self.severity_model, "severity_model.pkl")

    def train_category_model(self, X: np.ndarray, y: List[str]):
        """Train model to classify bug category"""
        print("\n📚 Training category classification model...")

        encoder = LabelEncoder()
        y_encoded = encoder.fit_transform(y)
        self.label_encoders["category"] = encoder

        X_train, X_test, y_train, y_test = train_test_split(
            X, y_encoded, test_size=0.2, random_state=42, stratify=y_encoded
        )

        self.category_model = GradientBoostingClassifier(n_estimators=100, random_state=42)
        self.category_model.fit(X_train, y_train)

        y_pred = self.category_model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred, average="weighted")

        print(f"  Accuracy: {accuracy:.3f}")
        print(f"  F1-Score: {f1:.3f}")

        print("\nClassification Report:")
        print(classification_report(y_test, y_pred, target_names=encoder.classes_))

        self._save_model(self.category_model, "category_model.pkl")

    def train_text_classifier(self, df: pd.DataFrame):
        """Train text-based bug description classifier"""
        print("\n📚 Training text classification model...")

        descriptions = df["bugData"].apply(lambda x: x.get("description", "")).tolist()
        labels = df["bugData"].apply(lambda x: x.get("issue", "")).tolist()

        # Vectorize text
        self.text_vectorizer = TfidfVectorizer(
            max_features=500, ngram_range=(1, 2), min_df=2
        )
        X = self.text_vectorizer.fit_transform(descriptions)

        encoder = LabelEncoder()
        y_encoded = encoder.fit_transform(labels)
        self.label_encoders["issue"] = encoder

        # Train
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_encoded, test_size=0.2, random_state=42
        )

        model = RandomForestClassifier(n_estimators=50, random_state=42, n_jobs=-1)
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)

        print(f"  Accuracy: {accuracy:.3f}")

        self._save_model(model, "text_classifier_model.pkl")
        self._save_model(self.text_vectorizer, "text_vectorizer.pkl")

    def evaluate(self):
        """Evaluate all trained models"""
        print("\n📊 Model Evaluation Summary")
        print("=" * 50)

        models_info = [
            ("Severity Model", self.severity_model),
            ("Category Model", self.category_model),
        ]

        for name, model in models_info:
            if model is not None:
                print(f"\n{name}:")
                print(f"  - Type: {type(model).__name__}")
                print(f"  - Parameters: {model.get_params()}")
            else:
                print(f"\n{name}: Not trained")

    def predict(self, bug_data: Dict) -> Dict:
        """Predict severity and category for a bug"""
        if self.severity_model is None:
            raise ValueError("Model not trained. Run train() first.")

        # Extract features
        features = self._extract_bug_features(bug_data)
        features_array = np.array(features).reshape(1, -1)

        predictions = {
            "bugData": bug_data,
            "predictions": {},
        }

        # Predict severity
        if self.severity_model:
            severity_pred = self.severity_model.predict(features_array)[0]
            severity_prob = self.severity_model.predict_proba(features_array)[0]
            predictions["predictions"]["severity"] = {
                "predicted": self.label_encoders["severity"].classes_[severity_pred],
                "confidence": float(np.max(severity_prob)),
            }

        # Predict category
        if self.category_model:
            category_pred = self.category_model.predict(features_array)[0]
            category_prob = self.category_model.predict_proba(features_array)[0]
            predictions["predictions"]["category"] = {
                "predicted": self.label_encoders["category"].classes_[category_pred],
                "confidence": float(np.max(category_prob)),
            }

        return predictions

    def _extract_bug_features(self, bug_data: Dict) -> List:
        """Extract features from a single bug"""
        return [
            {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(bug_data.get("severity"), 3),
            self._encode_category(bug_data.get("category")),
            len(json.dumps(bug_data.get("evidence", {}))),
            len(bug_data.get("description", "")),
            1,  # Default total bugs
            0,  # Default to desktop
            self._encode_locale("en-US"),
        ]

    def _save_model(self, model: Any, filename: str):
        """Save trained model"""
        filepath = self.model_dir / filename
        with open(filepath, "wb") as f:
            pickle.dump(model, f)
        print(f"  ✓ Saved: {filename}")

    def _load_model(self, filename: str) -> Any:
        """Load trained model"""
        filepath = self.model_dir / filename
        if filepath.exists():
            with open(filepath, "rb") as f:
                return pickle.load(f)
        return None


def main():
    parser = argparse.ArgumentParser(description="Train bug classification model")
    parser.add_argument(
        "--data",
        type=str,
        default="data/bug-detection/training-data.jsonl",
        help="Path to training data",
    )
    parser.add_argument(
        "--train",
        action="store_true",
        help="Train models",
    )
    parser.add_argument(
        "--evaluate",
        action="store_true",
        help="Evaluate trained models",
    )
    parser.add_argument(
        "--predict",
        type=str,
        help="Predict on bug data (JSON string)",
    )
    parser.add_argument(
        "--model-dir",
        type=str,
        default="models/bug-classification",
        help="Model directory",
    )

    args = parser.parse_args()

    model = BugClassificationModel(model_dir=args.model_dir)

    if args.train:
        if not Path(args.data).exists():
            print(f"Error: Training data file not found: {args.data}")
            sys.exit(1)

        df = model.load_training_data(args.data)

        # Train severity model
        X_sev, _ = model.extract_features(df)
        y_sev = df["bugData"].apply(lambda x: x.get("severity", "P3")).tolist()
        model.train_severity_model(X_sev, y_sev)

        # Train category model
        X_cat, _ = model.extract_features(df)
        y_cat = df["bugData"].apply(lambda x: x.get("category", "ui")).tolist()
        model.train_category_model(X_cat, y_cat)

        # Train text classifier
        model.train_text_classifier(df)

        print("\n" + "=" * 50)
        print("✓ Training completed!")
        print("=" * 50)

    elif args.evaluate:
        model.evaluate()

    elif args.predict:
        try:
            bug_data = json.loads(args.predict)
            predictions = model.predict(bug_data)
            print(json.dumps(predictions, indent=2))
        except json.JSONDecodeError:
            print("Error: Invalid JSON input")
            sys.exit(1)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
