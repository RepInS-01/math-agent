---
name: knowledge-base
description: Extensible knowledge-base integration interface for Math Coach (reserved, not yet wired in) — unified search contract for consolidating mastered ideas and retrieving similar problems.
---

# Knowledge Base Interface

This skill defines an **extensible** knowledge-base integration interface for: consolidating mastered ideas, retrieving similar problems, and retrieving mathematical understanding backed by data or facts. It is currently a **reserved interface** — not actually wired in yet, but the contract is fixed so any implementation can plug in later.

## Unified Interface Contract

Every knowledge-base source implements the same `search` interface:

```
search(query) -> [{ source, title, snippet, url?, confidence: 'fact'|'data'|'reference'|'heuristic' }]
```

- `confidence` tags the nature of the content: fact (mathematical fact), data (data/computation-backed), reference (standard reference), heuristic (heuristic/personal experience).
- No implementation may return unverified "taste" or "one-off opinion" as fact.

## Local Knowledge Base Interface (reserved)

- Convention: workspace `kb/` directory (or preset `knowledge/`), one Markdown file per topic, filename = topic slug.
- Retrieval: `glob` + `grep` keyword search over `kb/`; on a hit, `read` the relevant files precisely.
- Optional index: `kb/index.md` maintains a topic → file mapping.
- Status: **not wired** (interface defined, directory convention ready).

## Online Knowledge Base Interface (reserved)

- Uses `web_search`, citing returned source URLs.
- Results are only for auxiliary understanding and cross-validation; merge and deduplicate with local results.
- Status: **not wired** (depends on the current web tool; usable directly but not auto-triggered by default).

## Usage Rules

- In the final synthesis: when a knowledge base is available, **prefer** understandings backed by facts and data, and cite the source.
- Distinguish "mathematical fact / data-backed" from "personal taste / heuristic": the former may ground conclusions, the latter may only serve as an exploration direction and must be labeled as such.
- When retrieving similar problems, rank by "topic relevance → similar difficulty → already consolidated".
