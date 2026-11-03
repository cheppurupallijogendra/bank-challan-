# Retention Lens

A churn analysis website built from `Churn_Modelling.csv` (10,000 bank customers).

- Backend: Python, Flask, pandas (`app.py`)
- Front end: HTML, CSS, JavaScript, Chart.js (`static/`)

## Run it

```bash
python -m venv venv
venv\Scripts\activate          # Windows (Mac/Linux: source venv/bin/activate)
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000 in your browser. You need an internet connection so the
page can load Chart.js and the fonts.

## Project layout

```
retention-lens/
  app.py                  Flask server and all data analysis (pandas)
  requirements.txt
  data/Churn_Modelling.csv
  static/
    index.html            page structure
    style.css             design
    app.js                charts, heatmap, explorer, table
```

## API endpoints

| Endpoint | What it returns |
| --- | --- |
| `/api/overview` | totals, churn rate, averages, leavers vs stayers |
| `/api/churn-by?dim=geography` | churn rate per group (geography, gender, age, products, active, card, credit, tenure, balance) |
| `/api/hotspots` | highest-risk group in each split |
| `/api/distribution?field=age` | stayed vs left counts per bin (age, credit, balance) |
| `/api/correlation` | correlation matrix |
| `/api/segment?...` | churn rate for any filter mix |
| `/api/customers?...` | searchable, sortable, paged customer list |
