"""Reproducible Block 1 baseline comparison for CareerGuard Lite.

The experiment compares text-only, structured-only, and combined
text-plus-structured logistic-regression pipelines on EMSCAD.  It deliberately
does not describe the EMSCAD structured fields as live browser metadata.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import matplotlib
import bs4

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from bs4 import BeautifulSoup
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    classification_report,
    confusion_matrix,
    f1_score,
    log_loss,
    matthews_corrcoef,
    ndcg_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


TEXT_COLUMNS = [
    "title",
    "company_profile",
    "description",
    "requirements",
    "benefits",
]
CATEGORICAL_COLUMNS = [
    "location",
    "department",
    "salary_range",
    "employment_type",
    "required_experience",
    "required_education",
    "industry",
    "function",
]
BINARY_COLUMNS = ["telecommuting", "has_company_logo", "has_questions"]
TARGET_COLUMN = "fraudulent"
ID_COLUMN = "job_id"
REQUIRED_COLUMNS = {
    ID_COLUMN,
    TARGET_COLUMN,
    *TEXT_COLUMNS,
    *CATEGORICAL_COLUMNS,
    *BINARY_COLUMNS,
}


@dataclass(frozen=True)
class CleanReport:
    rows_after_cleaning: int
    removed_empty_rows: int
    removed_conflicting_duplicate_rows: int
    removed_same_label_exact_duplicates: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "fake_job_postings.csv",
    )
    parser.add_argument(
        "--results-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "block1_results",
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "block1_models",
    )
    parser.add_argument("--random-state", type=int, default=42)
    parser.add_argument("--max-features", type=int, default=40_000)
    parser.add_argument("--timing-repeats", type=int, default=7)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_html_text(value: Any) -> str:
    if pd.isna(value):
        return ""
    text = BeautifulSoup(str(value), "html.parser").get_text(" ")
    return " ".join(text.split())


def load_and_clean(path: Path) -> tuple[pd.DataFrame, pd.DataFrame, CleanReport]:
    raw = pd.read_csv(path)
    missing_columns = sorted(REQUIRED_COLUMNS - set(raw.columns))
    if missing_columns:
        raise ValueError(f"Dataset is missing required columns: {missing_columns}")

    missing_report = pd.DataFrame(
        {
            "missing_count": raw.isna().sum(),
            "missing_percent": (raw.isna().mean() * 100).round(2),
        }
    ).sort_values("missing_percent", ascending=False)

    data = raw[raw[TARGET_COLUMN].isin([0, 1])].copy()
    data[TARGET_COLUMN] = data[TARGET_COLUMN].astype(int)

    for column in TEXT_COLUMNS:
        data[column] = data[column].map(clean_html_text)

    data["combined_text"] = (
        "[TITLE] "
        + data["title"]
        + " [COMPANY] "
        + data["company_profile"]
        + " [DESCRIPTION] "
        + data["description"]
        + " [REQUIREMENTS] "
        + data["requirements"]
        + " [BENEFITS] "
        + data["benefits"]
    )

    for column in CATEGORICAL_COLUMNS:
        data[column] = data[column].fillna("MISSING").astype(str).str.strip()
        data.loc[data[column].eq(""), column] = "MISSING"

    for column in BINARY_COLUMNS:
        data[column] = pd.to_numeric(data[column], errors="coerce").fillna(0).astype(int)

    before_empty = len(data)
    usable_text = data["combined_text"].str.replace(r"\[[A-Z]+\]", "", regex=True).str.strip()
    data = data[usable_text.ne("")].copy()
    removed_empty = before_empty - len(data)

    feature_columns = ["combined_text", *CATEGORICAL_COLUMNS, *BINARY_COLUMNS]
    data["_feature_hash"] = pd.util.hash_pandas_object(data[feature_columns], index=False)
    distinct_labels = data.groupby("_feature_hash")[TARGET_COLUMN].nunique()
    conflicting_hashes = distinct_labels[distinct_labels.gt(1)].index

    before_conflicts = len(data)
    data = data[~data["_feature_hash"].isin(conflicting_hashes)].copy()
    removed_conflicts = before_conflicts - len(data)

    before_duplicates = len(data)
    data = data.drop_duplicates(subset=feature_columns, keep="first").copy()
    removed_duplicates = before_duplicates - len(data)
    data = data.drop(columns="_feature_hash").reset_index(drop=True)

    report = CleanReport(
        rows_after_cleaning=len(data),
        removed_empty_rows=removed_empty,
        removed_conflicting_duplicate_rows=removed_conflicts,
        removed_same_label_exact_duplicates=removed_duplicates,
    )
    return data, missing_report, report


def split_data(
    data: pd.DataFrame, random_state: int
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    train, temporary = train_test_split(
        data,
        test_size=0.30,
        stratify=data[TARGET_COLUMN],
        random_state=random_state,
    )
    validation, test = train_test_split(
        temporary,
        test_size=0.50,
        stratify=temporary[TARGET_COLUMN],
        random_state=random_state,
    )

    assert set(train.index).isdisjoint(validation.index)
    assert set(train.index).isdisjoint(test.index)
    assert set(validation.index).isdisjoint(test.index)
    return train, validation, test


def make_text_vectorizer(max_features: int) -> TfidfVectorizer:
    return TfidfVectorizer(
        lowercase=True,
        stop_words="english",
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.98,
        max_features=max_features,
        sublinear_tf=True,
    )


def make_classifier(random_state: int) -> LogisticRegression:
    return LogisticRegression(
        class_weight="balanced",
        max_iter=2_000,
        solver="liblinear",
        random_state=random_state,
    )


def make_structured_transformer() -> ColumnTransformer:
    categorical = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    binary = Pipeline([("imputer", SimpleImputer(strategy="most_frequent"))])
    return ColumnTransformer(
        [
            ("categorical", categorical, CATEGORICAL_COLUMNS),
            ("binary", binary, BINARY_COLUMNS),
        ]
    )


def build_models(random_state: int, max_features: int) -> dict[str, Pipeline]:
    text_only = Pipeline(
        [
            ("tfidf", make_text_vectorizer(max_features)),
            ("classifier", make_classifier(random_state)),
        ]
    )
    structured_only = Pipeline(
        [
            ("features", make_structured_transformer()),
            ("classifier", make_classifier(random_state)),
        ]
    )
    combined = Pipeline(
        [
            (
                "features",
                ColumnTransformer(
                    [
                        ("text", make_text_vectorizer(max_features), "combined_text"),
                        ("structured", make_structured_transformer(), CATEGORICAL_COLUMNS + BINARY_COLUMNS),
                    ]
                ),
            ),
            ("classifier", make_classifier(random_state)),
        ]
    )
    return {
        "Text-only baseline": text_only,
        "Structured-only baseline": structured_only,
        "Combined text + structured": combined,
    }


def model_view(frame: pd.DataFrame, model_name: str):
    if model_name == "Text-only baseline":
        return frame["combined_text"]
    if model_name == "Structured-only baseline":
        return frame[CATEGORICAL_COLUMNS + BINARY_COLUMNS]
    return frame[["combined_text", *CATEGORICAL_COLUMNS, *BINARY_COLUMNS]]


def select_f1_threshold(y_true: np.ndarray, scores: np.ndarray) -> tuple[float, float]:
    precision, recall, thresholds = precision_recall_curve(y_true, scores)
    if thresholds.size == 0:
        return 0.5, 0.0
    f1_values = 2 * precision[:-1] * recall[:-1] / np.maximum(
        precision[:-1] + recall[:-1], np.finfo(float).eps
    )
    best_f1 = float(np.nanmax(f1_values))
    tied = np.flatnonzero(np.isclose(f1_values, best_f1, rtol=0, atol=1e-12))
    # A higher threshold is the conservative tie-break for an advisory warning tool.
    best_index = int(tied[-1])
    return float(thresholds[best_index]), best_f1


def precision_at_k(y_true: np.ndarray, scores: np.ndarray, k: int) -> float:
    actual_k = min(k, len(y_true))
    order = np.argsort(-scores, kind="mergesort")[:actual_k]
    return float(y_true[order].sum() / actual_k)


def recall_at_k(y_true: np.ndarray, scores: np.ndarray, k: int) -> float:
    positives = int(y_true.sum())
    if positives == 0:
        return 0.0
    actual_k = min(k, len(y_true))
    order = np.argsort(-scores, kind="mergesort")[:actual_k]
    return float(y_true[order].sum() / positives)


def ndcg_at_k(y_true: np.ndarray, scores: np.ndarray, k: int) -> float:
    return float(ndcg_score(y_true.reshape(1, -1), scores.reshape(1, -1), k=min(k, len(y_true))))


def measure_scoring_time(model: Pipeline, x_test, repeats: int) -> dict[str, float]:
    model.predict_proba(x_test.iloc[: min(32, len(x_test))])
    batch_times: list[float] = []
    for _ in range(repeats):
        started = time.perf_counter()
        model.predict_proba(x_test)
        batch_times.append(time.perf_counter() - started)

    sample_count = min(100, len(x_test))
    single_times: list[float] = []
    for index in range(sample_count):
        started = time.perf_counter()
        model.predict_proba(x_test.iloc[index : index + 1])
        single_times.append((time.perf_counter() - started) * 1_000)

    batch_ms_per_record = np.asarray(batch_times) * 1_000 / len(x_test)
    return {
        "Batch scoring median (s)": float(np.median(batch_times)),
        "Batch throughput median (ms/record)": float(np.median(batch_ms_per_record)),
        "Single-record latency median (ms)": float(np.median(single_times)),
        "Single-record latency p95 (ms)": float(np.percentile(single_times, 95)),
    }


def split_summary(name: str, frame: pd.DataFrame) -> dict[str, Any]:
    counts = frame[TARGET_COLUMN].value_counts().to_dict()
    return {
        "split": name,
        "rows": len(frame),
        "real": int(counts.get(0, 0)),
        "fake": int(counts.get(1, 0)),
        "fake_percent": round(float(frame[TARGET_COLUMN].mean() * 100), 2),
    }


def safe_model_filename(model_name: str) -> str:
    return model_name.lower().replace(" + ", "_plus_").replace(" ", "_").replace("-", "_") + ".joblib"


def run_experiment(args: argparse.Namespace) -> None:
    np.random.seed(args.random_state)
    args.results_dir.mkdir(parents=True, exist_ok=True)
    args.models_dir.mkdir(parents=True, exist_ok=True)

    data, missing_report, clean_report = load_and_clean(args.data)
    train, validation, test = split_data(data, args.random_state)
    y_train = train[TARGET_COLUMN].to_numpy()
    y_validation = validation[TARGET_COLUMN].to_numpy()
    y_test = test[TARGET_COLUMN].to_numpy()

    models = build_models(args.random_state, args.max_features)
    results: list[dict[str, Any]] = []
    rankings: list[dict[str, Any]] = []
    predictions: list[pd.DataFrame] = []
    classifications: dict[str, Any] = {}
    confusion_rows: list[dict[str, Any]] = []
    pr_curves: dict[str, tuple[np.ndarray, np.ndarray]] = {}

    for model_name, model in models.items():
        x_train = model_view(train, model_name)
        x_validation = model_view(validation, model_name)
        x_test = model_view(test, model_name)

        fit_started = time.perf_counter()
        model.fit(x_train, y_train)
        fit_seconds = time.perf_counter() - fit_started

        validation_scores = model.predict_proba(x_validation)[:, 1]
        threshold, validation_f1 = select_f1_threshold(y_validation, validation_scores)
        test_scores = model.predict_proba(x_test)[:, 1]
        test_predictions = (test_scores >= threshold).astype(int)

        timing = measure_scoring_time(model, x_test, args.timing_repeats)
        row = {
            "Model": model_name,
            "Precision": precision_score(y_test, test_predictions, zero_division=0),
            "Recall": recall_score(y_test, test_predictions, zero_division=0),
            "F1": f1_score(y_test, test_predictions, zero_division=0),
            "Accuracy": accuracy_score(y_test, test_predictions),
            "Balanced accuracy": balanced_accuracy_score(y_test, test_predictions),
            "MCC": matthews_corrcoef(y_test, test_predictions),
            "PR-AUC": average_precision_score(y_test, test_scores),
            "ROC-AUC": roc_auc_score(y_test, test_scores),
            "Brier score": brier_score_loss(y_test, test_scores),
            "Log loss": log_loss(y_test, np.column_stack([1 - test_scores, test_scores]), labels=[0, 1]),
            "Threshold": threshold,
            "Validation F1 at selected threshold": validation_f1,
            "Predicted fake count": int(test_predictions.sum()),
            "Training time (s)": fit_seconds,
            **timing,
        }
        for k in (10, 50, 100):
            precision_k = precision_at_k(y_test, test_scores, k)
            recall_k = recall_at_k(y_test, test_scores, k)
            ndcg_k = ndcg_at_k(y_test, test_scores, k)
            rankings.append(
                {
                    "Model": model_name,
                    "K": k,
                    "Precision@K": precision_k,
                    "Recall@K": recall_k,
                    "NDCG@K": ndcg_k,
                }
            )
            if k == 10:
                row.update({"Precision@10": precision_k, "Recall@10": recall_k, "NDCG@10": ndcg_k})

        matrix = confusion_matrix(y_test, test_predictions, labels=[0, 1])
        for true_label in (0, 1):
            for predicted_label in (0, 1):
                confusion_rows.append(
                    {
                        "Model": model_name,
                        "True label": true_label,
                        "Predicted label": predicted_label,
                        "Count": int(matrix[true_label, predicted_label]),
                    }
                )

        classifications[model_name] = classification_report(
            y_test,
            test_predictions,
            labels=[0, 1],
            target_names=["Real", "Fake"],
            output_dict=True,
            zero_division=0,
        )
        predictions.append(
            pd.DataFrame(
                {
                    ID_COLUMN: test[ID_COLUMN].to_numpy(),
                    "true_label": y_test,
                    "model": model_name,
                    "fraud_probability": test_scores,
                    "selected_threshold": threshold,
                    "predicted_label": test_predictions,
                }
            )
        )
        precision_curve, recall_curve, _ = precision_recall_curve(y_test, test_scores)
        pr_curves[model_name] = (recall_curve, precision_curve)
        joblib.dump(model, args.models_dir / safe_model_filename(model_name))
        results.append(row)

    results_frame = pd.DataFrame(results)
    ordered_columns = [
        "Model",
        "Precision@10",
        "Recall@10",
        "NDCG@10",
        "Precision",
        "Recall",
        "F1",
        "Accuracy",
        "Balanced accuracy",
        "MCC",
        "PR-AUC",
        "ROC-AUC",
        "Brier score",
        "Log loss",
        "Threshold",
        "Validation F1 at selected threshold",
        "Predicted fake count",
        "Training time (s)",
        "Batch scoring median (s)",
        "Batch throughput median (ms/record)",
        "Single-record latency median (ms)",
        "Single-record latency p95 (ms)",
    ]
    results_frame = results_frame[ordered_columns]
    ranking_frame = pd.DataFrame(rankings)
    prediction_frame = pd.concat(predictions, ignore_index=True)
    split_frame = pd.DataFrame(
        [
            split_summary("train", train),
            split_summary("validation", validation),
            split_summary("test", test),
        ]
    )
    split_ids = pd.concat(
        [
            train[[ID_COLUMN]].assign(split="train"),
            validation[[ID_COLUMN]].assign(split="validation"),
            test[[ID_COLUMN]].assign(split="test"),
        ],
        ignore_index=True,
    )

    results_frame.to_csv(args.results_dir / "block1_model_results.csv", index=False)
    ranking_frame.to_csv(args.results_dir / "block1_ranking_by_k.csv", index=False)
    prediction_frame.to_csv(args.results_dir / "block1_test_predictions.csv", index=False)
    split_frame.to_csv(args.results_dir / "block1_split_summary.csv", index=False)
    split_ids.to_csv(args.results_dir / "block1_split_ids.csv", index=False)
    missing_report.to_csv(args.results_dir / "block1_missing_report.csv")
    pd.DataFrame(confusion_rows).to_csv(args.results_dir / "block1_confusion_matrices.csv", index=False)
    (args.results_dir / "block1_classification_reports.json").write_text(
        json.dumps(classifications, indent=2), encoding="utf-8"
    )

    run_config = {
        "run_timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "random_state": args.random_state,
        "dataset_file": str(args.data.resolve()),
        "dataset_sha256": sha256_file(args.data),
        "script_sha256": sha256_file(Path(__file__)),
        "rows_after_cleaning": clean_report.rows_after_cleaning,
        "removed_empty_rows": clean_report.removed_empty_rows,
        "removed_exact_duplicates": clean_report.removed_same_label_exact_duplicates,
        "removed_conflicting_duplicate_rows": clean_report.removed_conflicting_duplicate_rows,
        "split": {"train": 0.70, "validation": 0.15, "test": 0.15},
        "text_columns": TEXT_COLUMNS,
        "categorical_structured_columns": CATEGORICAL_COLUMNS,
        "binary_structured_columns": BINARY_COLUMNS,
        "threshold_rule": "Maximise F1 on validation scores; use highest threshold as an exact-F1 tie-break",
        "model_family": "LogisticRegression(class_weight='balanced', solver='liblinear')",
        "max_tfidf_features": args.max_features,
        "timing_repeats": args.timing_repeats,
        "environment": {
            "python": sys.version,
            "platform": platform.platform(),
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
            "matplotlib": matplotlib.__version__,
            "beautifulsoup4": bs4.__version__,
        },
        "claim_boundary": (
            "EMSCAD structured fields are not live browser page metadata. "
            "The timing values are offline local-runtime measurements, not browser end-to-end latency."
        ),
    }
    (args.results_dir / "block1_run_config.json").write_text(
        json.dumps(run_config, indent=2), encoding="utf-8"
    )

    figure, axes = plt.subplots(1, 2, figsize=(13, 5.2))
    comparison = results_frame.set_index("Model")[["Precision@10", "Recall@10", "NDCG@10", "F1", "PR-AUC"]]
    comparison.plot(kind="bar", ax=axes[0], width=0.8)
    axes[0].set_title("Block 1 baseline comparison")
    axes[0].set_ylabel("Score")
    axes[0].set_xlabel("")
    axes[0].set_ylim(0, 1.05)
    axes[0].tick_params(axis="x", rotation=12)
    axes[0].legend(fontsize=8)

    for model_name, (recall_curve, precision_curve) in pr_curves.items():
        axes[1].plot(recall_curve, precision_curve, label=model_name)
    axes[1].set_title("Precision-recall curves")
    axes[1].set_xlabel("Recall")
    axes[1].set_ylabel("Precision")
    axes[1].set_xlim(0, 1)
    axes[1].set_ylim(0, 1.05)
    axes[1].grid(alpha=0.2)
    axes[1].legend(fontsize=8)
    figure.tight_layout()
    figure.savefig(args.results_dir / "block1_model_comparison.png", dpi=220)
    figure.savefig(args.results_dir / "block1_model_comparison.svg")
    plt.close(figure)

    print(results_frame.to_string(index=False, float_format=lambda value: f"{value:.6f}"))
    print(f"\nResults written to: {args.results_dir.resolve()}")
    print(f"Models written to: {args.models_dir.resolve()}")


if __name__ == "__main__":
    run_experiment(parse_args())
