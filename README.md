Prefer it in your browser? https://aviagentics.com/checkup/

# website-checkup

A plain-English report card for a small business website. Give it one web address; it reads that one page and tells you what is working, what needs attention, and how to fix it. One file, Node 18 or newer, no dependencies, nothing stored.

## Usage

    npx website-checkup https://example.com
    node checkup.mjs https://example.com
    node checkup.mjs https://example.com --json

## What it checks

Each check is a pass, a warning or a fail, with one plain sentence on why and one plain fix. The score is 0 to 100 (pass counts fully, warning half).

- Secure connection (https)
- Page title present, 10 to 65 characters
- Search description present
- Works on phones (mobile viewport tag)
- Exactly one main heading
- A phone number or email visible
- A clear next step: a book, order, reserve, appointment, contact or quote button or link
- A chat or assistant on the page
- Page size (the HTML itself)
- Images missing a description (alt text)
- A footer copyright year older than this year
- Link preview when shared (og:title and og:image)

## Safety

Only http and https on the standard ports. It reads at most 1.5 MB, waits at most 8 seconds, follows at most 3 redirects (checking each one), and refuses localhost, private networks and number addresses. It identifies itself as `AviAgenticsCheckup/1.0`. It reads a single page and does not crawl.

## License

MIT, see LICENSE.
