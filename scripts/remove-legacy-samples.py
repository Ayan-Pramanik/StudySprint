"""One-time local cleanup of legacy sample-tagged records; preserves user records."""
import sqlite3, json, pathlib, datetime
root = pathlib.Path('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
for path in root.glob('*.sqlite'):
    db = sqlite3.connect(path)
    if not db.execute("SELECT name FROM sqlite_master WHERE name='workspaces'").fetchone():
        db.close()
        continue
    changed = 0
    for ident, raw in db.execute('SELECT id,data FROM workspaces').fetchall():
        data = json.loads(raw)
        if not any(item.get('demo') for key in ('subjects','notes','cards') for item in data.get(key,[])):
            continue
        for key in ('subjects','notes','cards','events'):
            data[key] = [item for item in data.get(key,[]) if not item.get('demo')]
        db.execute('UPDATE workspaces SET data=?,version=version+1 WHERE id=?',(json.dumps(data),ident))
        changed += 1
    removed = db.execute("DELETE FROM review_events WHERE json_extract(data,'$.demo')=1").rowcount
    db.commit()
    db.close()
    print(f'Removed legacy sample content from {changed} workspaces and {removed} review events; user-created records preserved.')
