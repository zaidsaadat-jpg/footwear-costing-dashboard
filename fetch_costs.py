"""
Cost fetcher - updates material costs in cost_data.json

CURRENT BEHAVIOUR:
  Returns simulated cost updates. This is intentional - you should
  decide which price sources you trust before enabling real scraping.

TO ENABLE REAL UPDATES LATER:
  Replace the body of fetch_material_costs() with a requests.get()
  call to a price source you trust, then parse the response.
"""

import json
from datetime import datetime

def fetch_material_costs():
    """
    Return a dictionary of {product_id: {material_key: new_cost}}.
    Currently simulated - replace with real sources later.
    """
    return {
        "velocity-nitro-4": {
            "outsole_rubber": 2.45,
            "midsole_foam": 3.95
        },
        "future-9-match": {
            "outsole_rubber": 3.10
        }
    }

def update_cost_data():
    with open('cost_data.json', 'r') as f:
        data = json.load(f)

    updates = fetch_material_costs()
    changed = 0

    for product in data['products']:
        pid = product['id']
        if pid not in updates:
            continue
        for key, new_cost in updates[pid].items():
            if key in product['bom']:
                old = product['bom'][key]['cost']
                product['bom'][key]['cost'] = new_cost
                product['bom'][key]['source'] = "Updated: " + datetime.now().strftime("%Y-%m-%d")
                print(f"{pid}.{key}: {old} -> {new_cost}")
                changed += 1

    data['last_updated'] = datetime.now().strftime("%Y-%m-%d")

    with open('cost_data.json', 'w') as f:
        json.dump(data, f, indent=2)

    print(f"Done. {changed} cost value(s) updated.")

if __name__ == "__main__":
    update_cost_data()
