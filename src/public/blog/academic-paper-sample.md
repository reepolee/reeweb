---
layout: academic
title: "Distributed Template Rendering in Modern Web Systems"

authors:
    - name: "Dr. Elena Novak"
      department: "Dept. of Web Infrastructure"
      affiliation: "Institute of Web Infrastructure"
      city: "Ljubljana"
      country: "Slovenia"
      email: "elena.novak@example.org"
      orcid: "0000-0002-1825-0097"

    - name: "Marcus Lee"
      department: "Dept. of Systems Research"
      affiliation: "Open Systems Research Group"
      city: "Berlin"
      country: "Germany"
      email: "marcus.lee@example.org"

published_at: "2026-05-27"
doi: "10.1109/EXAMPLE.2026.0001"

abstract: |
    Distributed server-side rendering has emerged as a critical concern
    for web systems operating at scale. This paper presents a modular
    rendering architecture that decouples template execution from data
    acquisition, enabling parallel pipeline stages across geographically
    distributed edge nodes. We evaluate three rendering strategies -
    server-side, client-side, and hybrid - under simulated concurrency
    loads ranging from 1,000 to 250,000 simultaneous users. Experimental
    results show that hybrid rendering reduces average response latency
    by 43% relative to pure server-side rendering while constraining
    memory overhead to within 28% of the client-side baseline. These
    findings suggest that partial hydration combined with streamed HTML
    delivery represents a viable path toward high-throughput, low-latency
    document generation for modern distributed applications.

keywords:
    - distributed rendering
    - server-side rendering
    - partial hydration
    - web infrastructure
    - template pipelines
    - edge computing

acknowledgment: |
    The authors thank the Open Infrastructure Consortium for access to
    benchmarking hardware, and Dr. Petra Kovač for her feedback on early
    drafts of this manuscript. This work received no external funding.

references: |
    <ol>
      <li>
        R. T. Fielding, "Architectural Styles and the Design of
        Network-based Software Architectures," Ph.D. dissertation,
        Univ. of California, Irvine, CA, USA, 2000.
      </li>
      <li>
        L. Meyerovich, A. Guha, J. Baskin, G. H. Cooper, M. Greenberg,
        A. Bromfield, and S. Krishnamurthi, "Flapjax: A Programming
        Language for Ajax Applications," <em>ACM SIGPLAN Not.</em>,
        vol. 44, no. 10, pp. 1–20, Oct. 2009.
      </li>
      <li>
        E. Novak, "Streaming HTML Systems at Scale," in
        <em>Proc. IEEE Int. Conf. Web Eng.</em>, Ljubljana, Slovenia,
        2025, pp. 88–97.
      </li>
      <li>
        M. Lee and E. Novak, "Edge-Native Partial Hydration for
        Low-Latency Document Delivery," <em>IEEE Trans. Cloud Comput.</em>,
        vol. 14, no. 2, pp. 310–322, Apr. 2026.
      </li>
      <li>
        T. Berners-Lee, R. Fielding, and L. Masinter, "Uniform Resource
        Identifier (URI): Generic Syntax," IETF RFC 3986, Jan. 2005.
        [Online]. Available: https://www.rfc-editor.org/rfc/rfc3986
      </li>
    </ol>
---

# Introduction

Modern rendering systems increasingly rely on distributed execution
pipelines to reduce latency and improve scalability at the infrastructure
level. Traditional monolithic rendering architectures introduce
deterministic bottlenecks in systems that must sustain millions of
concurrent document requests - particularly under variable network
conditions and heterogeneous client capabilities [1].

This paper evaluates a modular rendering architecture in which template
execution, data acquisition, and HTML streaming are decoupled into
independently scalable pipeline stages. The proposed design draws on
recent advances in edge computing and partial hydration to deliver
low-latency responses without sacrificing the interactivity guarantees
expected of contemporary web applications.

The remainder of this paper is organized as follows. Section II reviews
the historical evolution of server-side rendering. Section III describes
the proposed rendering pipeline in detail. Section IV presents
experimental results under simulated load. Section V concludes with
directions for future work.

# Background

## Historical Evolution of Server-Side Rendering

Early web systems rendered complete HTML pages synchronously on the
server using tightly coupled template engines. Frameworks such as CGI,
PHP, and JSP produced full-document responses on each request, making
dynamic content universally accessible without client-side scripting.

The widespread adoption of JavaScript runtimes in browsers shifted
significant rendering responsibility to the client. Single-page
application (SPA) frameworks reduced server load but introduced
measurable first-contentful-paint penalties and complicated search
engine indexing [2].

> The balance between interactivity and delivery performance remains
> one of the defining tensions of modern web architecture.

More recent approaches - including React Server Components, Astro's
island architecture, and Qwik's resumability model - have attempted to
recover server-rendering efficiency while preserving client-side
interactivity. These frameworks share a common insight: not all
components on a page require hydration, and selective rendering can
substantially reduce both payload size and time-to-interactive.

## Partial Hydration

Partial hydration refers to the practice of delivering statically
rendered HTML for the majority of a document while hydrating only those
subtrees that require interactivity [3]. This contrasts with full
hydration, in which the client re-executes all component logic to
reconcile server-produced markup with a client-owned virtual DOM.

The performance implications are significant. In benchmark conditions,
partially hydrated pages achieve interactive states 1.8–3.4× faster
than equivalently complex fully hydrated counterparts, at the cost of
increased rendering coordination logic on the server.

# Rendering Pipeline

## Architecture Overview

The proposed pipeline consists of five sequential stages executed
across a distributed node cluster:

1. **Data acquisition** - parallel fetch from origin data sources with
   request-level memoization
2. **Normalization** - schema validation and field coercion against a
   shared document model
3. **Template execution** - deterministic HTML generation from
   normalized data using an isolated template runtime
4. **Streaming** - incremental chunk delivery over HTTP/2 with
   early-flush of above-the-fold content
5. **Client hydration** - selective island mounting on received markup

Each stage communicates via typed message contracts, enabling
independent horizontal scaling and fault isolation. Stages 1–3 execute
on origin workers; stage 4 on edge nodes; stage 5 on the client.

## Implementation

The following pseudocode illustrates the core response handler at
the edge node level:

```ts
const html = render(template, {
	title,
	authors,
	body,
});

return new Response(html, {
	headers: {
		"Content-Type": "text/html; charset=utf-8",
		"Transfer-Encoding": "chunked",
	},
});
```

Template execution is sandboxed per request. Shared state is
explicitly prohibited at the template layer; any cross-request
caching occurs upstream in the normalization stage.

## Fault Tolerance

Node failures at any pipeline stage are handled through immediate
fallback to the next available replica. The streaming stage maintains
a 200ms flush budget; if a downstream stage does not produce output
within this window, a skeletal above-the-fold frame is emitted and
the remaining content is delivered asynchronously via a secondary
streaming connection.

# Experimental Results

## Methodology

The proposed system was benchmarked under simulated traffic loads
ranging from 1,000 to 250,000 concurrent users on a 24-node cluster
distributed across three geographic regions. Three rendering strategies
were evaluated: pure server-side rendering (SSR), pure client-side
rendering (CSR), and the proposed hybrid model.

Each configuration was subjected to a 10-minute sustained load test
followed by a 2-minute spike to peak concurrency. Latency measurements
represent the 95th-percentile time-to-first-byte at the edge node.

## Results

<table>
  <caption>Table I - Rendering Strategy Comparison at 50k Concurrent Users</caption>
  <thead>
    <tr>
      <th>Strategy</th>
      <th>P95 Latency</th>
      <th>Memory / Node</th>
      <th>TTFB Improvement</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>SSR (baseline)</td><td>42 ms</td><td>180 MB</td><td>-</td></tr>
    <tr><td>CSR</td><td>18 ms</td><td>420 MB</td><td>+57%</td></tr>
    <tr><td>Hybrid (proposed)</td><td>24 ms</td><td>230 MB</td><td>+43%</td></tr>
  </tbody>
</table>

The hybrid model achieved a 43% reduction in P95 latency relative to
the SSR baseline while consuming 45% less memory per node than the CSR
configuration. These results held consistently across all three
geographic regions, with a variance of less than 3 ms across sites.

At peak concurrency (250,000 users), the hybrid pipeline maintained
sub-50ms P95 latency, whereas the SSR configuration degraded to
380 ms under equivalent load. The CSR configuration was unaffected
by concurrency at the server but showed client-side interaction delays
of 620–890 ms on median-spec mobile hardware.

# Conclusion

Distributed rendering architectures with partial hydration offer
substantial improvements in both scalability and response latency
relative to monolithic server-side or pure client-side approaches.
The proposed pipeline demonstrates that decoupling template execution
from data acquisition - and separating streaming from hydration - can
yield consistent sub-30ms P95 response times at production-scale
concurrency without requiring prohibitive memory resources per node [4].

Future research should investigate edge-native rendering models that
eliminate the origin fetch entirely for cacheable document classes, as
well as incremental transport protocols capable of resuming
partially-delivered documents across intermittent connections [5].
Integration with WebAssembly-based template runtimes represents a
further avenue for portable, sandboxed execution at the edge.
