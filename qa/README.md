# Browser checks

End-to-end checks that drive a real browser (Edge or Chrome) through the shop and the staff area: ordering, search and filters,
saved lists, the wanted list, covers by drag and drop, staff tabs, accessibility (axe), and what visitors see when things break.
They are not part of the deploy; `npm test` in the main folder covers the build and the Worker.

```bash
cd qa
npm install        # once: puppeteer-core only, it uses the browser you already have
node run.mjs       # everything, about four minutes
node run.mjs wants tabs   # just those
```

`run.mjs` builds the site, serves it on port 8080, starts the pretend staff service (`worker/dev.mjs`, fresh for each check) and
prints a verdict per check. When something fails it says where the full log is (in a `flickers-qa` folder in your temp directory,
along with screenshots). Set `QA_BROWSER` if no browser is found. Nothing here talks to the live shop, Discord or GitHub.

The checks build from a fixed set of 40 comics in `qa/fixture/` (a snapshot of real ones, with small covers), so they don't break when the shop's stock changes.
`QA_LIVE_DATA=1 node run.mjs` uses the shop's real stock instead, and `node make-fixture.mjs` rebuilds the fixture (only needed if it should change).

Each `*.mjs` file also runs on its own once the site is built and served (`npm run build`, `npm run serve`, and `npm run dev:api`
for the staff checks), which is handy while changing one thing.

## Looking at the site

`node shots.mjs <folder>` (with the site served on :8080, e.g. `npm run serve`) saves desktop and phone screenshots of the home page for a quick visual check.
