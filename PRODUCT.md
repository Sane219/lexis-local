# Product

## Register

product

## Users

Privacy-conscious knowledge workers — lawyers, researchers, analysts — reading
dense PDFs (contracts, papers, reports) on their own machine. Their context is
focused, single-document reading where they need to interrogate the text and
trust that nothing leaves the device. The job: understand a document faster
without surrendering it to a cloud service.

## Product Purpose

LexisLocal turns a local PDF into something you can question, navigate, and
verify — RAG chat grounded in the actual text, a selectable text layer,
extracted definitions, and anomaly checks — running 100% offline against a
llama.cpp server on localhost. Success is the reader staying in flow: answers
and definitions appear where attention already is, with zero cloud round-trip.

## Brand Personality

Quiet, precise, trustworthy. The interface is a reading instrument, not a
showpiece — it disappears into the task. Confidence comes from accuracy and
restraint, not decoration.

## Anti-references

Not a chat-first AI product wrapper (no glowing gradients, no chrome competing
with the document). Not a cloud SaaS dashboard with hero metrics. Not a
playful consumer app — the personality is professional-tool, closer to a
code editor or a legal reader than to a marketing site.

## Design Principles

- **The document is the subject.** UI chrome stays neutral and recedes; the
  PDF and its text are the focus.
- **Answers where attention is.** Definitions, citations, and navigation
  surface in place rather than pulling the reader away.
- **Trust through grounding.** Every AI surface ties back to source text and
  page, never a free-floating claim.
- **Offline is not a compromise.** Local-first should feel as polished as any
  cloud tool, not like a lesser fallback.

## Accessibility & Inclusion

WCAG AA: body/UI text ≥4.5:1 contrast. Keyboard- and screen-reader-accessible
interactive surfaces (Radix primitives). Honor `prefers-reduced-motion` on every
transition.
