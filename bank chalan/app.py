"""Retention Lens: Flask backend for the Churn_Modelling dataset.

Run:  python app.py   then open http://127.0.0.1:5000
"""
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "data" / "Churn_Modelling.csv"

app = Flask(__name__, static_folder="static", static_url_path="")

# --------------------------------------------------------------------------
# Load and prepare the data (done once, when the server starts)
# --------------------------------------------------------------------------
df = pd.read_csv(DATA_PATH)

df["AgeGroup"] = pd.cut(
    df["Age"], [17, 29, 39, 49, 59, 120],
    labels=["18–29", "30–39", "40–49", "50–59", "60+"],
)
df["CreditBand"] = pd.cut(
    df["CreditScore"], [0, 579, 669, 739, 799, 850],
    labels=["Poor (<580)", "Fair (580–669)", "Good (670–739)",
            "Very good (740–799)", "Exceptional (800+)"],
)
df["BalanceBand"] = pd.cut(
    df["Balance"], [-1, 0, 50_000, 100_000, 150_000, 200_000, 260_000],
    labels=["No balance", "1–50k", "50–100k", "100–150k", "150–200k", "200k+"],
)
df["Membership"] = df["IsActiveMember"].map({1: "Active", 0: "Inactive"})
df["CardLabel"] = df["HasCrCard"].map({1: "Has card", 0: "No card"})

# dimension key -> (column in the dataframe, label shown on the page)
DIMENSIONS = {
    "geography": ("Geography", "Country"),
    "gender": ("Gender", "Gender"),
    "age": ("AgeGroup", "Age group"),
    "products": ("NumOfProducts", "Products held"),
    "active": ("Membership", "Membership"),
    "card": ("CardLabel", "Credit card"),
    "credit": ("CreditBand", "Credit score"),
    "tenure": ("Tenure", "Years with bank"),
    "balance": ("BalanceBand", "Balance"),
}

# Histogram settings: key -> (column, bin edges, bin labels)
DISTRIBUTIONS = {
    "age": (
        "Age",
        list(range(14, 95, 5)),
        [f"{a + 1}–{a + 5}" for a in range(14, 94, 5)],
    ),
    "credit": (
        "CreditScore",
        [349] + list(range(399, 800, 50)) + [850],
        ["350–399", "400–449", "450–499", "500–549", "550–599", "600–649",
         "650–699", "700–749", "750–799", "800–850"],
    ),
    "balance": (
        "Balance",
        [-1, 0] + list(range(25_000, 250_001, 25_000)) + [260_000],
        ["0", "1–25k", "25–50k", "50–75k", "75–100k", "100–125k", "125–150k",
         "150–175k", "175–200k", "200–225k", "225–250k", "250k+"],
    ),
}

OVERALL_RATE = float(df["Exited"].mean() * 100)


def group_stats(column):
    """Customers, leavers and churn rate for each value of `column`."""
    grouped = df.groupby(column, observed=True)["Exited"].agg(["count", "sum", "mean"])
    return [
        {
            "label": str(label),
            "customers": int(row["count"]),
            "churned": int(row["sum"]),
            "rate": round(float(row["mean"]) * 100, 1),
        }
        for label, row in grouped.iterrows()
    ]


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------
@app.get("/api/overview")
def overview():
    metrics = [
        ("Age", "Average age", "decimal"),
        ("CreditScore", "Average credit score", "whole"),
        ("Balance", "Average balance", "money"),
        ("EstimatedSalary", "Average salary", "money"),
        ("Tenure", "Years with the bank", "decimal"),
        ("NumOfProducts", "Products held", "decimal"),
    ]
    means = df.groupby("Exited")[[m[0] for m in metrics]].mean()
    profile = [
        {
            "label": label,
            "kind": kind,
            "stayed": round(float(means.loc[0, col]), 2),
            "left": round(float(means.loc[1, col]), 2),
        }
        for col, label, kind in metrics
    ]
    return jsonify(
        total=int(len(df)),
        churned=int(df["Exited"].sum()),
        rate=round(OVERALL_RATE, 1),
        avg_age=round(float(df["Age"].mean()), 1),
        avg_credit=round(float(df["CreditScore"].mean())),
        avg_balance=round(float(df["Balance"].mean())),
        active_share=round(float(df["IsActiveMember"].mean() * 100), 1),
        profile=profile,
    )


@app.get("/api/churn-by")
def churn_by():
    key = request.args.get("dim", "geography")
    if key not in DIMENSIONS:
        return jsonify(error="Unknown dimension"), 400
    column, label = DIMENSIONS[key]
    return jsonify(
        dimension=label,
        overall=round(OVERALL_RATE, 1),
        groups=group_stats(column),
    )


@app.get("/api/hotspots")
def hotspots():
    """The single highest-churn group in each dimension (groups of 50+ customers)."""
    found = []
    for column, label in DIMENSIONS.values():
        groups = [g for g in group_stats(column) if g["customers"] >= 50]
        if not groups:
            continue
        top = max(groups, key=lambda g: g["rate"])
        found.append({
            "dimension": label,
            "group": top["label"],
            "rate": top["rate"],
            "customers": top["customers"],
            "lift": round(top["rate"] / OVERALL_RATE, 1),
        })
    found.sort(key=lambda g: g["rate"], reverse=True)
    return jsonify(found[:6])


@app.get("/api/distribution")
def distribution():
    key = request.args.get("field", "age")
    if key not in DISTRIBUTIONS:
        return jsonify(error="Unknown field"), 400
    column, edges, labels = DISTRIBUTIONS[key]
    binned = pd.cut(df[column], bins=edges, labels=labels, right=True)
    counts = (
        df.assign(_bin=binned)
        .groupby(["_bin", "Exited"], observed=False)
        .size()
        .unstack(fill_value=0)
        .reindex(labels, fill_value=0)
    )
    return jsonify(
        labels=labels,
        stayed=[int(v) for v in counts.get(0, pd.Series(0, index=labels))],
        left=[int(v) for v in counts.get(1, pd.Series(0, index=labels))],
    )


@app.get("/api/correlation")
def correlation():
    columns = {
        "CreditScore": "Credit score",
        "Age": "Age",
        "Tenure": "Tenure",
        "Balance": "Balance",
        "NumOfProducts": "Products",
        "HasCrCard": "Has card",
        "IsActiveMember": "Active",
        "EstimatedSalary": "Salary",
        "Exited": "Left bank",
    }
    matrix = df[list(columns)].corr().round(2)
    return jsonify(labels=list(columns.values()), matrix=matrix.values.tolist())


@app.get("/api/segment")
def segment():
    """Churn rate for any combination of filters."""
    args = request.args
    mask = pd.Series(True, index=df.index)

    if args.get("geography") in ("France", "Germany", "Spain"):
        mask &= df["Geography"] == args["geography"]
    if args.get("gender") in ("Female", "Male"):
        mask &= df["Gender"] == args["gender"]
    age_min = args.get("age_min", type=int)
    age_max = args.get("age_max", type=int)
    if age_min is not None:
        mask &= df["Age"] >= age_min
    if age_max is not None:
        mask &= df["Age"] <= age_max
    products = args.get("products", type=int)
    if products is not None:
        mask &= df["NumOfProducts"] == products
    active = args.get("active", type=int)
    if active in (0, 1):
        mask &= df["IsActiveMember"] == active
    card = args.get("card", type=int)
    if card in (0, 1):
        mask &= df["HasCrCard"] == card

    subset = df[mask]
    if subset.empty:
        return jsonify(customers=0, churned=0, rate=0, overall=round(OVERALL_RATE, 1),
                       avg_balance=0, avg_credit=0)
    return jsonify(
        customers=int(len(subset)),
        churned=int(subset["Exited"].sum()),
        rate=round(float(subset["Exited"].mean() * 100), 1),
        overall=round(OVERALL_RATE, 1),
        avg_balance=round(float(subset["Balance"].mean())),
        avg_credit=round(float(subset["CreditScore"].mean())),
    )


TABLE_COLUMNS = ["CustomerId", "Surname", "Geography", "Gender", "Age", "Tenure",
                 "CreditScore", "Balance", "NumOfProducts", "IsActiveMember", "Exited"]


@app.get("/api/customers")
def customers():
    args = request.args
    per_page = 12
    page = max(args.get("page", 1, type=int), 1)
    query = args.get("q", "").strip().lower()
    status = args.get("status", "")
    sort = args.get("sort", "CustomerId")
    if sort not in TABLE_COLUMNS:
        sort = "CustomerId"
    ascending = args.get("order", "asc") != "desc"

    view = df
    if query:
        view = view[view["Surname"].str.lower().str.contains(query, regex=False)]
    if status == "left":
        view = view[view["Exited"] == 1]
    elif status == "stayed":
        view = view[view["Exited"] == 0]
    view = view.sort_values(sort, ascending=ascending, kind="stable")

    total = int(len(view))
    pages = max(-(-total // per_page), 1)
    page = min(page, pages)
    chunk = view.iloc[(page - 1) * per_page: page * per_page]
    return jsonify(
        rows=chunk[TABLE_COLUMNS].to_dict("records"),
        total=total,
        page=page,
        pages=pages,
        per_page=per_page,
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)
