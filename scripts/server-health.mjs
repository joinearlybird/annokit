/**
 * Start the installed `annokit` bin in `cwd`, ask it for /health,
 * and stop it. Shared by verify-consumer and verify-starter, since "the bin
 * runs from an install" is the quick start's second step in both.
 */
import { spawn } from "node:child_process";

export async function serverAnswers(cwd) {
  const port = 40000 + Math.floor(Math.random() * 20000);
  // Its own process group, so stopping it stops the server too. On Linux
  // npx runs the bin as a child of its own: killing only npx left the
  // server holding our pipes open, and the calling script never exited.
  const child = spawn("npx", ["--no-install", "annokit", "server", "--port", String(port), "--no-agent"],
    { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  try {
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error(`exited with ${child.exitCode}: ${output.trim().split("\n").slice(-3).join(" | ")}`);
      try {
        const body = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
        if (body.protocolVersion !== 1) throw new Error(`/health answered ${JSON.stringify(body)}`);
        return;
      } catch (e) {
        if (e.message.startsWith("/health")) throw e;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`no answer on :${port} within 10s`);
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
    child.stdout.destroy();
    child.stderr.destroy();
  }
}
