from pathlib import Path
p = Path("d:/new app/admin_app/js/admin.js")
s = p.read_text()
marker1 = "async function renderProducts() { loading(); try { const [result, catResult] = await Promise.all([api('/admin/products'), api('/categories')]);"
marker2 = "async function renderProducts() {\n  loading();\n  try {\n    const [productData, categoryData] = await Promise.all([api('/admin/products'), api('/admin/categories')]);"
i = s.find(marker1)
j = s.find(marker2, i)
if i == -1 or j == -1:
    raise SystemExit("markers not found")
s = s[:i] + s[j:]
p.write_text(s)
print("removed block from", i, "to", j)
