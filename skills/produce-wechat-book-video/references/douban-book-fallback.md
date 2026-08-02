# Douban book-metadata fallback

Use this reference only after WeRead title search completed successfully and returned no matching book. WeRead remains the primary edition and popular-highlight source.

## Trigger boundary

Run the fallback only when the recorded WeRead result is `no_matching_book`.

Do not trigger it when:

- WeRead is unavailable, times out, returns `upgrade_info`, or cannot authenticate;
- WeRead returns several plausible editions;
- the title extracted from the transcript is missing or low-confidence;
- the user has not supplied enough identity evidence to distinguish editions.

Those cases remain explicit blockers or use the existing WeRead disambiguation flow.

## Installed source tool

The user-selected repository is installed at `F:/Codex/tools/DouBanSpider` from:

`https://github.com/lanbing510/DouBanSpider.git`

The upstream script is a legacy Python 2 tag crawler. Do not execute its unbounded tag loop in production. Use the bundled Python 3 adapter for a bounded single-title lookup:

```powershell
python scripts/lookup_douban_book.py `
  --title "<book-title>" `
  --author "<optional-author>" `
  --isbn "<optional-isbn>" `
  --output "<work-dir>/book_metadata/douban-book.json" `
  --download-cover `
  --cover-output "<work-dir>/cover/original-douban.jpg"
```

The adapter performs one suggestion request and at most five subject-detail requests. It does not crawl tags, reviews, ratings, quotes, or highlights; it does not bypass CAPTCHA, login, rate limits, or other access controls. Stop and preserve the error on HTTP 403, 418, or 429.

When the first lookup returns several editions, do not search again after the user chooses one. Reuse the saved candidates and select the confirmed subject ID locally:

```powershell
python scripts/lookup_douban_book.py `
  --title "<book-title>" `
  --from-metadata "<work-dir>/book_metadata/douban-book.json" `
  --subject-id "<confirmed-douban-subject-id>" `
  --output "<work-dir>/book_metadata/douban-book-selected.json" `
  --download-cover `
  --cover-output "<work-dir>/cover/original-douban.jpg"
```

## Selection and storage

- Save every returned candidate with title, author, translator, publisher, publication date, ISBN, Douban subject ID/URL, and cover URL when available.
- Automatically select only a unique ISBN match, unique exact-title-and-author match, or unique exact-title match.
- When multiple plausible editions remain, keep `selectionStatus=ambiguous`, show candidates, and stop for edition confirmation.
- Never download a cover before a unique edition is selected.
- Save the downloaded cover under `cover/`, along with byte count and SHA-256 from the adapter output.
- Record `bookIdentitySource=douban_book` and `wereadLookupStatus=no_matching_book` in `script_sources.md` or the direct-final metadata package.

## Evidence boundary

Douban fallback may support only:

- book title;
- author and translator;
- publisher and publication date;
- ISBN and edition disambiguation;
- original-cover acquisition from the selected subject listing.

It must not supply or verify:

- WeRead popular highlights;
- book quotations;
- chapter text;
- claims attributed to the book;
- derivative-copy evidence;
- reviews or ratings as content evidence.

On the normal derivative path, Douban metadata alone does not satisfy G01. If WeRead has no matching book, obtain another user-approved textual source with traceable quotations or stop before derivative drafting. In direct-final-script mode, production may continue with user-approved wording, but the script must still not be labeled as verified book text.
