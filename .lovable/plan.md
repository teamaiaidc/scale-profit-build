The 504 errors on `/node_modules/.vite/deps/react*.js` are stale Vite dependency pre-bundle artifacts, not a code bug.

## Fix
1. `rm -rf node_modules/.vite` to clear the dep cache.
2. Restart the dev server so Vite re-optimizes deps cleanly.

No source files change.