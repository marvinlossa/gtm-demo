"""Parser and stage-order checks. No network."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import gtm_fit_analysis as job


def test_invalid_payload():
    events = list(job.run({}))
    assert events[0]["body"]["status"] == "failed"
    assert events[0]["body"]["error"] == "INVALID_PAYLOAD"


def test_research_parse_and_prompt_shape():
    ctx = {
        "domain": "example.com",
        "normalizedUrl": "https://example.com",
        "profileId": "sales-expansion",
        "attributes": [
            {
                "id": "hiring",
                "label": "Hiring",
                "researchPrompt": "Look at {domain} hiring",
                "positiveSignals": ["AE"],
                "negativeSignals": ["layoff"],
            }
        ],
    }
    prompt = job.build_research_prompt(ctx)
    assert "example.com" in prompt
    assert "Look at example.com hiring" in prompt
    assert "positive: AE" in prompt
    parsed = job.parse_json_object(
        '```json\n{"findings":[{"attributeId":"hiring","present":true,"confidence":0.8,"scoreHint":70,"evidence":[{"snippet":"Hiring AEs","sourceUrl":"https://example.com"}]}]}\n```'
    )
    findings = job.normalize_findings(ctx, parsed)
    assert findings[0]["present"] == "true"
    assert findings[0]["evidence"][0]["snippet"] == "Hiring AEs"
    assert len(findings[0]["evidence"]) == 1


def test_strategy_error_codes(monkeypatch=None):
    class Boom(Exception):
        pass

    original = job.post_json

    def fail_research(*_args, **_kwargs):
        return 502, None

    job.post_json = fail_research
    payload = {
        "jobId": "job-1",
        "domain": "example.com",
        "normalizedUrl": "https://example.com",
        "profileId": "sales-expansion",
        "callbackUrl": "internal://jobs/job-1",
        "executionId": "py-job-1",
        "attributes": [{"id": "hiring", "label": "Hiring", "researchPrompt": "x"}],
    }
    try:
        events = list(job.run(payload))
    finally:
        job.post_json = original
    assert [event["body"]["status"] for event in events] == ["running", "failed"]
    assert events[0]["body"]["stage"] == "research"
    assert events[1]["body"]["error"] == "RESEARCH_HTTP_ERROR"

    def research_ok(url, *_args, **_kwargs):
        if "perplexity" in url:
            return 200, {
                "output_text": json.dumps(
                    {
                        "findings": [
                            {
                                "attributeId": "hiring",
                                "present": "unknown",
                                "confidence": 0.2,
                                "scoreHint": 10,
                                "evidence": [],
                            }
                        ]
                    }
                )
            }
        return 500, None

    job.post_json = research_ok
    try:
        events = list(job.run(payload))
    finally:
        job.post_json = original
    assert [event["body"].get("stage") or event["body"].get("error") for event in events] == [
        "research",
        "strategy",
        "STRATEGY_HTTP_ERROR",
    ]


def test_strategy_json_parse():
    original = job.post_json

    def both(url, *_args, **_kwargs):
        if "perplexity" in url:
            return 200, {
                "output_text": json.dumps(
                    {"findings": [{"attributeId": "hiring", "present": "true"}]}
                )
            }
        return 200, {"choices": [{"message": {"content": "not json"}}]}

    job.post_json = both
    payload = {
        "jobId": "job-1",
        "domain": "example.com",
        "callbackUrl": "internal://jobs/job-1",
        "executionId": "py-job-1",
        "attributes": [{"id": "hiring", "label": "Hiring"}],
    }
    try:
        events = list(job.run(payload))
    finally:
        job.post_json = original
    assert events[-1]["body"]["error"] == "STRATEGY_JSON_PARSE"


def test_research_text_with_citations_and_fences():
    prose = """
Research notes before the object.
```json
{"findings":[{"attributeId":"hiring","present":"unknown","confidence":0.4,"scoreHint":40,"evidence":[{"snippet":"Hiring AEs"}]}]}
```
Citation: see {the company blog} and [1].
"""
    parsed = job.parse_json_object(prose)
    assert isinstance(parsed, dict)
    assert parsed["findings"][0]["attributeId"] == "hiring"

    trailing = (
        '{"findings":[{"attributeId":"hiring","present":true,"confidence":0.5,"scoreHint":70,"evidence":[]}]}'
        '\nSources: {"url":"https://example.com","title":"Blog"}'
    )
    parsed = job.parse_json_object(trailing)
    assert parsed["findings"][0]["attributeId"] == "hiring"

    envelope = {
        "output": [
            {
                "type": "search_results",
                "content": [{"type": "text", "text": "Snippet with {braces} that is not findings."}],
            },
            {
                "type": "message",
                "content": [
                    {
                        "type": "output_text",
                        "text": '{"findings":[{"attributeId":"hiring","present":"true"}]}',
                        "annotations": [
                            {"type": "citation", "url": "https://example.com", "start_index": 0, "end_index": 4}
                        ],
                    }
                ],
            },
        ]
    }
    text = job.extract_text(envelope)
    assert "Snippet" not in text
    assert job.parse_json_object(text)["findings"][0]["attributeId"] == "hiring"


def test_agent_envelope_and_js_numbers():
    text = job.extract_text(
        {
            "object": "response",
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": '{"findings":[{"attributeId":"hiring","present":true,"confidence":0.5,"scoreHint":70,"evidence":[{"snippet":"Hiring — AEs"}]}]}',
                        }
                    ],
                }
            ],
        }
    )
    parsed = job.parse_json_object(text)
    findings = job.normalize_findings(
        {"attributes": [{"id": "hiring"}]},
        parsed,
    )
    encoded = json.dumps(findings, indent=2, ensure_ascii=False)
    assert '"scoreHint": 70' in encoded
    assert "70.0" not in encoded
    assert "Hiring — AEs" in encoded
    assert '"confidence": 0.5' in encoded


if __name__ == "__main__":
    test_invalid_payload()
    test_research_parse_and_prompt_shape()
    test_strategy_error_codes()
    test_strategy_json_parse()
    test_research_text_with_citations_and_fences()
    test_agent_envelope_and_js_numbers()
    print("gtm fit analysis checks passed")
