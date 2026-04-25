import { spawn } from 'child_process';
import path from 'path';

export type CrawlResult = {
  ok: boolean;
  markdown?: string;
  error?: string;
  statusCode?: number;
};

const MAX_MARKDOWN_CHARS = 60_000;
const DEFAULT_DOCKER_IMAGE = process.env.CRAWL4AI_DOCKER_IMAGE || 'unclecode/crawl4ai:0.8';
const MAX_LOG_SNIPPET = 1200;

function trimForLog(text: string): string {
  const t = text.trim();
  return t.length > MAX_LOG_SNIPPET ? `${t.slice(0, MAX_LOG_SNIPPET)}...` : t;
}

function resolveScriptPath(): string {
  return path.join(process.cwd(), 'python', 'crawl_one.py');
}

function resolvePythonCommand(): { cmd: string; args: string[]; script: string } {
  const script = resolveScriptPath();
  const explicit = process.env.PYTHON_BIN?.trim();
  if (explicit) {
    return { cmd: explicit, args: [script], script };
  }
  if (process.platform === 'win32') {
    return { cmd: 'py', args: ['-3', script], script };
  }
  return { cmd: 'python3', args: [script], script };
}

function resolveCrawlCommand(url: string): { cmd: string; args: string[] } {
  const mode = (process.env.CRAWL4AI_MODE || 'docker').trim().toLowerCase();
  if (mode === 'python') {
    const { cmd, args } = resolvePythonCommand();
    return { cmd, args: [...args, url] };
  }

  // Docker-first mode: python script is baked into the image.
  // Build example:
  // docker build -f python/Dockerfile.crawl4ai -t pocgithubanalyse-crawl4ai:latest .
  const dockerCmd = process.env.DOCKER_BIN || 'docker';
  return {
    cmd: dockerCmd,
    args: ['run', '--rm', DEFAULT_DOCKER_IMAGE, url],
  };
}

function executeCrawlCommand(
  url: string,
  mode: 'docker' | 'python',
  cmd: string,
  args: string[]
): Promise<CrawlResult & { spawnErrMessage?: string }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    console.info('[crawl4ai] starting crawl', { url, mode, cmd, args });

    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      console.error('[crawl4ai] timeout reached, terminating crawler process', {
        url,
        timeoutMs: Number(process.env.CRAWL_TIMEOUT_MS) || 120_000,
      });
      child.kill('SIGTERM');
    }, Number(process.env.CRAWL_TIMEOUT_MS) || 120_000);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      const hint =
        mode === 'docker'
          ? 'Ensure image exists/pulls correctly, e.g. CRAWL4AI_DOCKER_IMAGE=unclecode/crawl4ai:0.8'
          : 'Set CRAWL4AI_MODE=python and ensure PYTHON_BIN/crawl4ai are installed.';
      console.error('[crawl4ai] spawn failed', {
        url,
        mode,
        error: err.message,
      });
      resolve({
        ok: false,
        error: `spawn failed: ${err.message}. ${hint}`,
        spawnErrMessage: err.message,
      });
    });

    child.on('close', (code) => {
      clearTimeout(killTimer);
      const elapsedMs = Date.now() - startedAt;

      if (code !== 0 && !stdout.trim()) {
        const stderrSnippet = trimForLog(stderr);
        console.error('[crawl4ai] crawl failed', {
          url,
          mode,
          code,
          elapsedMs,
          timedOut,
          stderrSnippet,
        });
        resolve({
          ok: false,
          error: timedOut
            ? `crawler timed out after ${elapsedMs}ms`
            : stderr.trim() || `crawler exited with code ${code}`,
        });
        return;
      }
      try {
        const json = JSON.parse(stdout.trim()) as CrawlResult;
        if (json.markdown && json.markdown.length > MAX_MARKDOWN_CHARS) {
          json.markdown = json.markdown.slice(0, MAX_MARKDOWN_CHARS);
        }
        console.info('[crawl4ai] crawl completed', {
          url,
          mode,
          code,
          elapsedMs,
          ok: json.ok,
          statusCode: json.statusCode,
          markdownChars: json.markdown?.length ?? 0,
          stderrSnippet: stderr.trim() ? trimForLog(stderr) : undefined,
        });
        resolve(json);
      } catch {
        console.error('[crawl4ai] invalid crawler output', {
          url,
          mode,
          code,
          elapsedMs,
          stdoutSnippet: trimForLog(stdout),
          stderrSnippet: trimForLog(stderr),
        });
        resolve({
          ok: false,
          error: stderr.trim() || 'invalid JSON from crawl_one.py',
        });
      }
    });
  });
}

/**
 * Runs crawl4ai helper via Docker (default) or local Python fallback.
 */
export function crawlUrlWithCrawl4ai(url: string): Promise<CrawlResult> {
  return new Promise(async (resolve) => {
    const configuredMode = (process.env.CRAWL4AI_MODE || 'docker').trim().toLowerCase();
    const { cmd, args } = resolveCrawlCommand(url);
    const first = await executeCrawlCommand(
      url,
      configuredMode === 'python' ? 'python' : 'docker',
      cmd,
      args
    );

    const shouldFallbackToPython =
      configuredMode !== 'python' &&
      !first.ok &&
      typeof first.spawnErrMessage === 'string' &&
      /enoent/i.test(first.spawnErrMessage);

    if (!shouldFallbackToPython) {
      resolve(first);
      return;
    }

    console.warn('[crawl4ai] docker command unavailable, falling back to python mode', { url });
    const py = resolvePythonCommand();
    const fallback = await executeCrawlCommand(url, 'python', py.cmd, [...py.args, url]);
    resolve(fallback);
  });
}
