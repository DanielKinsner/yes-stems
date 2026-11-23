# Demucs Model Licensing Decision Record

**Status: unresolved owner/legal gate. Do not distribute the bundled pretrained
weights in a paid release until this record has an approved decision.**

This document records technical evidence and product options. It is not legal
advice.

## Verified evidence

- The Demucs repository publishes its software under the MIT License:
  <https://github.com/facebookresearch/demucs/blob/main/LICENSE>.
- The official README says `htdemucs` was trained on MUSDB HQ plus an additional
  dataset of 800 songs, and `htdemucs_6s` is the related experimental six-source
  model:
  <https://github.com/facebookresearch/demucs/blob/main/README.md>.
- The official issue asking whether the pretrained models may be redistributed
  in a commercial product remains open and unanswered:
  <https://github.com/facebookresearch/demucs/issues/327>.
- The Meta repository is archived and read-only, reducing the likelihood that
  the open issue will receive an authoritative answer there.

The MIT software license does not, by itself, provide sufficiently explicit
evidence that the downloaded checkpoint files and their training-data lineage
are cleared for paid redistribution.

## Product options

1. **Bundle the weights only after approval.** Obtain written confirmation from
   the relevant rights holder and legal review covering commercial use and
   redistribution of both checkpoint files.
2. **User-initiated model download.** Ship no checkpoints and let the user fetch
   them from the upstream location after explicit disclosure. This reduces the
   app vendor's direct redistribution surface, but it does not itself establish
   commercial-use rights and still requires legal review.
3. **Classic-DSP commercial edition.** Sell only the built-in Rust modes and
   make local ML unavailable. This has the clearest artifact provenance but a
   materially weaker product promise.
4. **Product-owned/licensed weights.** Train or license replacement models from
   a dataset whose commercial training and distribution rights are documented.
   This is the strongest long-term route and the most expensive.

## Owner decision

Record the selected option, reviewer/counsel, supporting evidence, date, and any
distribution conditions here before changing this gate to approved.
