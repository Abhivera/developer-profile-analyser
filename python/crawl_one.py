"""
Single-URL crawl helper for the Node worker (crawl4ai runs in Python).
Usage: python crawl_one.py <https://url>
Prints one JSON line to stdout: { ok, markdown?, error?, statusCode? }
"""
from __future__ import annotations

import asyncio
import json
import sys

def log_err(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


async def crawl(url: str) -> dict:
    try:
        from crawl4ai import AsyncWebCrawler  # type: ignore
    except ImportError as e:
        log_err(f"[crawl_one] crawl4ai import failed: {e}")
        return {"ok": False, "error": f"crawl4ai import failed: {e}"}

    result = None
    try:
        from crawl4ai.async_configs import BrowserConfig, CrawlerRunConfig  # type: ignore

        browser_config = BrowserConfig(headless=True, verbose=False)
        run_config = CrawlerRunConfig(word_count_threshold=10, page_timeout=45000)
        log_err(f"[crawl_one] crawling with configured mode: {url}")
        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=run_config)
    except Exception as e:
        log_err(f"[crawl_one] configured crawl failed, fallback to default crawler. error={e}")
        async with AsyncWebCrawler() as crawler:
            result = await crawler.arun(url=url)

    if result is None:
        return {"ok": False, "error": "no crawl result"}

    if not getattr(result, "success", False):
        err = getattr(result, "error_message", None) or "crawl failed"
        code = getattr(result, "status_code", None)
        log_err(f"[crawl_one] crawl failed: status={code}, error={err}, url={url}")
        return {"ok": False, "error": str(err), "statusCode": code}

    md = getattr(result, "markdown", None)
    text = ""
    if md is None:
        text = ""
    elif isinstance(md, str):
        text = md
    else:
        text = (
            getattr(md, "fit_markdown", None)
            or getattr(md, "raw_markdown", None)
            or ""
        ) or ""

    code = getattr(result, "status_code", None)
    log_err(f"[crawl_one] crawl success: status={code}, markdownChars={len(text)}, url={url}")
    return {"ok": True, "markdown": text[:80000], "statusCode": code}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing url"}))
        return
    url = sys.argv[1].strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        print(json.dumps({"ok": False, "error": "url must start with http(s)://"}))
        return
    out = asyncio.run(crawl(url))
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
