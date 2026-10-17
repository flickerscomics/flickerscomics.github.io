// Used by the "Browser checks" workflow when a run fails: prints short GitHub annotations (they show on the run page and can be read without logging in).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const clean = s => String(s).replace(/\r/g, "").replace(/%/g, "%25").replace(/\n/g, "%0A").slice(0, 1500);
const note = (title, text) => console.log(`::error title=${title}::${clean(text)}`);

let log = "";
try { log = fs.readFileSync("run.log", "utf8"); } catch (e) { /* no log */ }
const lines = log.split("\n").map(l => l.trimEnd()).filter(Boolean);
const verdicts = lines.filter(l => /^\s+(ok|FAIL)\s/.test(l));
note("Browser checks: result", (verdicts.length ? verdicts.slice(0, 40).join("\n") : lines.slice(-25).join("\n")) || "No output at all.");

const dir = path.join(os.tmpdir(), "flickers-qa");
let shown = 0;
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith(".log")) : []) {
  if (shown >= 4) break;
  const text = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(l => /FAIL|Error|rror:|Cannot|ENOENT|Failed to launch/.test(l)).slice(0, 4).join("\n");
  if (text) { note(`Details: ${f}`, text); shown++; }
}
