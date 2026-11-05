"""Run:  python -m unittest discover -s tests -v   (uses a temporary SQLite DB, no MySQL needed)"""
import io, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as appmod

HEAD = "product_name,category,sale_date,quantity,unit_price,region\n"
GOOD = HEAD + "Pen,Stationery,2026-01-10,3,0.10,North\nPen,Stationery,2026-01-20,2,0.10,South\nBook,Stationery,2026-03-05,4,12.50,North\n"

class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.c = appmod.create_app(dict(DB_ENGINE="sqlite", SQLITE_PATH=os.path.join(self.tmp, "t.db"), TESTING=True)).test_client()
    def up(self, text, name="s.csv"):
        return self.c.post("/api/import", data={"file": (io.BytesIO(text.encode()), name)}, content_type="multipart/form-data")

    def test_revenue_is_exact(self):
        self.up(GOOD)
        s = self.c.get("/api/analytics/summary").json
        self.assertEqual(s["total_revenue"], 50.50)          # 3*0.10 + 2*0.10 + 4*12.50 (no float drift)
        self.assertEqual(s["total_quantity"], 9); self.assertEqual(s["transactions"], 3)
        self.assertEqual(s["top_product"], "Book"); self.assertEqual(s["top_product_by_quantity"], "Pen")   # 5 units vs 4
        self.assertEqual(s["best_month"], "2026-03")
        p = self.c.get("/api/analytics/products").json
        self.assertEqual([(r["product_name"], r["revenue"], r["rank"]) for r in p], [("Book", 50.0, 1), ("Pen", 0.5, 2)])

    def test_monthly_fills_gaps_and_growth(self):
        self.up(GOOD)
        m = self.c.get("/api/analytics/monthly").json
        self.assertEqual([x["month"] for x in m], ["2026-01", "2026-02", "2026-03"])
        self.assertEqual(m[1]["revenue"], 0); self.assertEqual(m[1]["growth_pct"], -100.0)
        self.assertIsNone(m[0]["growth_pct"]); self.assertIsNone(m[2]["growth_pct"])   # previous month was 0

    def test_malformed_rows_reported_with_line_numbers(self):
        bad = HEAD + ("Pen,Stationery,2026-02-30,1,1,North\nPen,Stationery,2026-01-01,-1,1,North\n,Stationery,2026-01-01,1,1,North\n"
                      "Pen,Stationery,2026-01-01,x,1,North\nPen,Stationery,2026-01-01,1,abc,North\nPen,Stationery,2026-01-01,1,1,\n"
                      "only,two\nPen,Stationery,2026-01-01,1,1,North\n")
        r = self.up(bad); self.assertEqual(r.status_code, 201)
        self.assertEqual((r.json["inserted"], r.json["errors"], r.json["total_rows"]), (1, 7, 8))
        self.assertEqual([e["line"] for e in r.json["details"]], [2, 3, 4, 5, 6, 7, 8])
        self.assertIn("columns", r.json["details"][-1]["reason"])
        rep = self.c.get(f"/api/imports/{r.json['import_id']}/report.csv")
        self.assertIn("line,type,reason,original_row", rep.get_data(as_text=True))

    def test_missing_column_rejects_file(self):
        r = self.up("product_name,sale_date,quantity\nA,2026-01-01,1\n")
        self.assertEqual(r.status_code, 400); self.assertIn("category", r.json["error"])
        self.assertEqual(self.c.get("/api/imports").json, [])
        self.assertEqual(self.up("a,b\n1,2", "x.txt").status_code, 400)

    def test_duplicate_policy(self):
        r1 = self.up(GOOD + "pen,stationery,2026-01-10,3,0.10,north\n")        # in-file duplicate (case-insensitive)
        self.assertEqual((r1.json["inserted"], r1.json["duplicates"]), (3, 1))
        r2 = self.up(GOOD)                                                      # re-import same file
        self.assertEqual((r2.json["inserted"], r2.json["duplicates"]), (0, 3))
        self.assertEqual(self.c.get("/api/sales").json["total"], 3)
        self.assertEqual(r2.json["details"][0]["type"], "duplicate_existing")

    def test_manual_crud_and_product_guard(self):
        self.up(GOOD); pid = self.c.get("/api/products").json[0]["product_id"]
        self.assertEqual(self.c.post("/api/sales", json=dict(product_id=pid, sale_date="2026-04-01", quantity=0, unit_price=5, region="East")).status_code, 400)
        r = self.c.post("/api/sales", json=dict(product_id=pid, sale_date="2026-04-01", quantity=2, unit_price=5, region="east"))
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.c.delete(f"/api/products/{pid}").status_code, 409)
        self.assertEqual(self.c.delete(f"/api/sales/{r.json['sale_id']}").status_code, 200)
        self.assertEqual(self.c.post("/api/products", json=dict(product_name="Lamp", category="home")).status_code, 201)
        self.assertEqual(self.c.post("/api/products", json=dict(product_name="LAMP", category="home")).status_code, 409)

    def test_filters_and_charts(self):
        self.up(GOOD)
        self.assertEqual(self.c.get("/api/analytics/summary?region=South").json["total_revenue"], 0.2)
        self.assertEqual(self.c.get("/api/analytics/summary?start=bad").status_code, 400)
        for u in ("monthly", "products"):
            self.assertTrue(self.c.get(f"/api/charts/{u}.png").data.startswith(b"\x89PNG"))
        self.assertTrue(self.c.get("/api/charts/monthly.png?region=Nowhere").data.startswith(b"\x89PNG"))

if __name__ == "__main__": unittest.main()
