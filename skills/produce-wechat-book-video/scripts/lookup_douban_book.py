#!/usr/bin/env python3
"""Bounded Douban book-metadata fallback for the book-video skill.

This adapter performs one title suggestion request and, at most, a small
number of subject-detail requests. It never crawls tags, reviews, quotes, or
highlight content and does not attempt to bypass access controls.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.parse import urlparse
from urllib.request import Request, urlopen


SUGGEST_URL = "https://book.douban.com/j/subject_suggest?q={query}"
SOURCE_REPOSITORY = "https://github.com/lanbing510/DouBanSpider.git"
DEFAULT_TOOL_ROOT = "F:/Codex/tools/DouBanSpider"
SOURCE_COMMIT = "cf4523f84c6bcfa7904d21e0d307cd361cf718a0"
MIN_REQUEST_DELAY = 0.8
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 "
    "BookVideoFactory-DoubanMetadataFallback/1.0"
)


class LookupError(RuntimeError):
    pass


class AccessBlockedError(LookupError):
    pass


def fetch(url: str, timeout: float) -> tuple[bytes, str]:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read(), response.headers.get_content_type()
    except HTTPError as exc:
        if exc.code in {403, 418, 429}:
            raise AccessBlockedError(
                f"Douban blocked or rate-limited the request (HTTP {exc.code}); "
                "stop and retry later without bypassing the block."
            ) from exc
        raise LookupError(f"Douban request failed with HTTP {exc.code}.") from exc
    except URLError as exc:
        raise LookupError(f"Douban request failed: {exc.reason}") from exc


def clean_html(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"<br\s*/?>", " / ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip(" /:：\t\r\n")
    return value or None


def normalize(value: str | None) -> str:
    if not value:
        return ""
    value = unicodedata.normalize("NFKC", value).casefold()
    return "".join(char for char in value if char.isalnum())


def parse_publication_date(value: str | None) -> tuple[int, int | None, int | None] | None:
    """Parse the available year/month/day without inventing missing precision."""
    if not value:
        return None
    normalized = unicodedata.normalize("NFKC", value)
    match = re.search(
        r"(?P<year>\d{4})(?:\s*(?:年|[-./])\s*(?P<month>\d{1,2}))?"
        r"(?:\s*(?:月|[-./])\s*(?P<day>\d{1,2}))?",
        normalized,
    )
    if not match:
        return None
    year = int(match.group("year"))
    month = int(match.group("month")) if match.group("month") else None
    day = int(match.group("day")) if match.group("day") else None
    if not 1000 <= year <= 2999:
        return None
    if month is not None and not 1 <= month <= 12:
        return None
    if day is not None and not 1 <= day <= 31:
        return None
    return year, month, day


def choose_latest_publication(
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Return a uniquely latest candidate only when date precision supports it."""
    dated: list[tuple[dict[str, Any], tuple[int, int | None, int | None]]] = []
    for item in candidates:
        parsed = parse_publication_date(
            item.get("publicationDate") or item.get("year")
        )
        if parsed is None:
            return None
        dated.append((item, parsed))
    if len(dated) < 2:
        return None

    remaining = dated
    for index in range(3):
        values = [date[index] for _, date in remaining]
        if any(value is None for value in values):
            return None
        latest = max(value for value in values if value is not None)
        remaining = [entry for entry in remaining if entry[1][index] == latest]
        if len(remaining) == 1:
            return remaining[0][0]
    return None


def extract_info_field(info_html: str, labels: list[str]) -> str | None:
    for label in labels:
        pattern = (
            r'<span[^>]*class=["\']pl["\'][^>]*>\s*'
            + re.escape(label)
            + r"\s*:?\s*</span>\s*(.*?)(?=<br\s*/?>|</div>)"
        )
        match = re.search(pattern, info_html, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return clean_html(match.group(1))
    return None


def parse_subject_page(raw: bytes, fallback: dict[str, Any]) -> dict[str, Any]:
    text = raw.decode("utf-8", errors="replace")
    info_match = re.search(
        r'<div[^>]+id=["\']info["\'][^>]*>(.*?)</div>',
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    info_html = info_match.group(1) if info_match else ""
    cover_match = re.search(
        r'<a[^>]+class=["\'][^"\']*nbg[^"\']*["\'][^>]+href=["\']([^"\']+)',
        text,
        flags=re.IGNORECASE,
    )
    title_match = re.search(
        r'<span[^>]+property=["\']v:itemreviewed["\'][^>]*>(.*?)</span>',
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    title = clean_html(title_match.group(1)) if title_match else fallback.get("title")
    return {
        **fallback,
        "title": title,
        "author": extract_info_field(info_html, ["作者"])
        or fallback.get("author"),
        "translator": extract_info_field(info_html, ["译者"]),
        "publisher": extract_info_field(info_html, ["出版社"]),
        "publicationDate": extract_info_field(info_html, ["出版年"])
        or fallback.get("year"),
        "isbn": extract_info_field(info_html, ["ISBN"]),
        "originalTitle": extract_info_field(info_html, ["原作名"]),
        "series": extract_info_field(info_html, ["丛书"]),
        "coverUrl": html.unescape(cover_match.group(1))
        if cover_match
        else fallback.get("thumbnailUrl"),
    }


def choose_candidate(
    candidates: list[dict[str, Any]],
    title: str,
    author: str | None,
    isbn: str | None,
    subject_id: str | None,
) -> tuple[str, dict[str, Any] | None, list[str]]:
    exact_title = [item for item in candidates if normalize(item.get("title")) == normalize(title)]
    pool = exact_title or candidates
    reasons: list[str] = []

    if subject_id:
        subject_matches = [
            item
            for item in candidates
            if str(item.get("doubanSubjectId") or "") == subject_id
        ]
        if len(subject_matches) == 1:
            return "selected", subject_matches[0], ["explicit_subject_id_match"]
        reasons.append("requested_subject_id_not_found")

    if isbn:
        isbn_matches = [item for item in pool if normalize(item.get("isbn")) == normalize(isbn)]
        if len(isbn_matches) == 1:
            return "selected", isbn_matches[0], ["unique_isbn_match"]
        if not isbn_matches:
            reasons.append("requested_isbn_not_found")

    if author:
        wanted = normalize(author)
        author_matches = [
            item
            for item in pool
            if wanted and wanted in normalize(item.get("author"))
        ]
        if len(author_matches) == 1:
            return "selected", author_matches[0], ["unique_title_author_match"]
        if not author_matches:
            reasons.append("requested_author_not_found")
        else:
            pool = author_matches

    if len(pool) == 1 and normalize(pool[0].get("title")) == normalize(title):
        return "selected", pool[0], ["unique_exact_title_match"]
    if len(pool) > 1 and all(
        normalize(item.get("title")) == normalize(title) for item in pool
    ):
        latest = choose_latest_publication(pool)
        if latest:
            return "selected", latest, ["latest_publication_date_default"]
    if not candidates:
        return "no_match", None, reasons or ["no_book_candidates"]
    return "ambiguous", None, reasons or ["multiple_plausible_editions"]


def download_cover(url: str, output: Path, timeout: float, overwrite: bool) -> dict[str, Any]:
    hostname = (urlparse(url).hostname or "").lower()
    if hostname != "doubanio.com" and not hostname.endswith(".doubanio.com"):
        raise LookupError(f"Refusing non-Douban cover host: {hostname or 'missing'}")
    if output.exists() and not overwrite:
        raise LookupError(f"Cover output already exists: {output}")
    raw, content_type = fetch(url, timeout)
    if len(raw) < 1024 or not content_type.startswith("image/"):
        raise LookupError("Douban cover response was not a valid non-trivial image.")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw)
    return {
        "path": str(output.resolve()),
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "contentType": content_type,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Look up bounded Douban bibliographic metadata after WeRead returns no match."
    )
    parser.add_argument("--title", required=True)
    parser.add_argument("--author")
    parser.add_argument("--isbn")
    parser.add_argument("--subject-id")
    parser.add_argument(
        "--from-metadata",
        type=Path,
        help="Reuse candidates from a previous adapter output without another Douban search.",
    )
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-candidates", type=int, default=5, choices=range(1, 6))
    parser.add_argument("--request-delay", type=float, default=0.8)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--download-cover", action="store_true")
    parser.add_argument("--cover-output", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    if args.output.exists() and not args.overwrite:
        raise LookupError(f"Metadata output already exists: {args.output}")
    if not args.from_metadata and args.request_delay < MIN_REQUEST_DELAY:
        raise LookupError(
            f"Request delay must be at least {MIN_REQUEST_DELAY:.1f} seconds."
        )

    detail_warnings: list[str] = []
    if args.from_metadata:
        try:
            previous = json.loads(args.from_metadata.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise LookupError(f"Cannot read prior metadata: {exc}") from exc
        if previous.get("provider") != "douban_book" or not isinstance(
            previous.get("candidates"), list
        ):
            raise LookupError("Prior metadata is not a valid Douban fallback artifact.")
        candidates = previous["candidates"][: args.max_candidates]
        detail_warnings.append("Reused saved candidates; no new Douban search was sent.")
    else:
        raw, _ = fetch(SUGGEST_URL.format(query=quote(args.title)), args.timeout)
        try:
            suggestions = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LookupError("Douban suggestion response was not valid JSON.") from exc

        base_candidates: list[dict[str, Any]] = []
        for item in suggestions:
            if item.get("type") != "b":
                continue
            candidate_subject_id = str(item.get("id") or "").strip()
            if not candidate_subject_id:
                continue
            base_candidates.append(
                {
                    "doubanSubjectId": candidate_subject_id,
                    "doubanSubjectUrl": item.get("url")
                    or f"https://book.douban.com/subject/{candidate_subject_id}/",
                    "title": item.get("title"),
                    "author": item.get("author_name"),
                    "year": item.get("year"),
                    "thumbnailUrl": item.get("pic"),
                }
            )
            if len(base_candidates) >= args.max_candidates:
                break

        candidates = []
        for index, item in enumerate(base_candidates):
            if index:
                time.sleep(max(0.0, args.request_delay))
            try:
                detail_raw, _ = fetch(item["doubanSubjectUrl"], args.timeout)
                candidates.append(parse_subject_page(detail_raw, item))
            except AccessBlockedError:
                raise
            except LookupError as exc:
                detail_warnings.append(f"{item['doubanSubjectId']}: {exc}")
                candidates.append(item)

    status, selected, reasons = choose_candidate(
        candidates, args.title, args.author, args.isbn, args.subject_id
    )
    result: dict[str, Any] = {
        "provider": "douban_book",
        "query": {"title": args.title, "author": args.author, "isbn": args.isbn},
        "searchedAt": datetime.now(timezone.utc).isoformat(),
        "triggerRequired": "weread_search_returned_no_matching_book",
        "sourceTool": {
            "repository": SOURCE_REPOSITORY,
            "installedPath": DEFAULT_TOOL_ROOT,
            "installedCommit": SOURCE_COMMIT,
        },
        "selectionStatus": status,
        "selectionReasons": reasons,
        "selectedCandidate": selected,
        "candidates": candidates,
        "warnings": detail_warnings,
        "evidenceBoundary": {
            "allowed": [
                "book_title",
                "author",
                "translator",
                "publisher",
                "publication_date",
                "isbn",
                "edition_candidate",
                "cover",
            ],
            "forbiddenAsVerifiedBookEvidence": [
                "quotes",
                "popular_highlights",
                "book_claims",
                "reviews",
                "ratings",
            ],
        },
    }

    if args.download_cover:
        if not selected:
            result["warnings"].append(
                "Cover not downloaded because the edition was not uniquely selected."
            )
        elif not selected.get("coverUrl"):
            result["warnings"].append("Selected edition did not expose a cover URL.")
        else:
            cover_output = args.cover_output or args.output.with_name(
                f"douban-cover-{selected['doubanSubjectId']}.jpg"
            )
            result["coverFile"] = download_cover(
                selected["coverUrl"], cover_output, args.timeout, args.overwrite
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"status": status, "output": str(args.output.resolve())}, ensure_ascii=False))
    return {"selected": 0, "no_match": 2, "ambiguous": 3}[status]


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LookupError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(4)
