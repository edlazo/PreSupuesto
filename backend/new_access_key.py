"""Print a fresh ACCESS_KEY and the private link that goes with it.

    python new_access_key.py https://tu-app.vercel.app

Put the key in the backend's environment as ACCESS_KEY and restart it; send
the link to whoever uses the app. Running this again and swapping the key
revokes every link and session handed out before.
"""

import secrets
import sys

key = secrets.token_urlsafe(32)
site = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")

print(f"ACCESS_KEY={key}")
print(f"Link:      {site}/entrar#k={key}")
