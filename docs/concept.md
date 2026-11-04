# Impromptu: better questions, documented answers

## The pitch

An organisation can buy AI access for thousands of employees without giving everyone the context or habits needed to get useful results. Impromptu brings prompt coaching and company knowledge into the moment an employee needs help.

Copy a message, press a keyboard shortcut, and get help understanding the question, finding the relevant documentation, and writing a response the employee can review. The longer-term goal is better task outcomes at a lower total cost per successful task.

This document preserves the team's hackathon concept and distinguishes the current application from future ideas. The original brief is available in the [hackathon canvas](https://impromptu-hackathon-brief.hyland-0170.chatgpt.site/#idea).

## The problem

- An unclear request can lead to irrelevant answers, repeated attempts, and extra review work.
- Useful context is spread across Confluence pages, Jira issues, and everyday conversations.
- Employees have different roles and levels of familiarity with AI; learning prompt techniques should fit into real work.
- Spending on AI does not by itself show whether the resulting work is accurate or useful.

The first use case is an ambiguous Teams comment: the employee wants to understand the background and respond constructively without manually searching several systems.

## The experience

1. Select and copy a comment from Teams or another application.
2. Press **Command+Shift+I** on Mac or **Ctrl+Shift+I** on Windows.
3. Review the imported text and optionally provide a project, topic, or issue key.
4. Search the connected Hyland Confluence and Jira sources.
5. Read the supporting passages, documented facts, and remaining questions.
6. Edit the suggested reply, copy it with source links, and send it yourself.

The companion also offers a prompt workspace: preserve the employee's request, add a relevant skill and context, review an improved prompt, and carry it into the AI tool they choose.

## What the prototype implements

The v0.2.1 application has its own Electron desktop window, a menu-bar or tray presence, a global summon shortcut, and System, Light, and Dark appearances. The Mac release includes an installer and a portable app. The Windows x64 release is a portable app and still needs execution testing on Windows.

The prompt workspace includes five starter skills, offline prompt structuring, optional model-based rewriting through Ollama or an approved API, saved sessions, feedback, and personal progress signals. Offline mode is deterministic; it does not perform model inference.

The knowledge workspace reuses a local, signed-in Codex installation and its Atlassian connector. It performs bounded, read-only retrieval and can produce a source-backed explanation and editable reply. Quotation and citation checks validate provenance. They do not establish that every conclusion is correct or that the retrieved material is complete.

The installed app includes its own desktop runtime. Knowledge lookup still depends on the employee's local Codex installation, compatible app-server APIs, connector access, and account usage. Installing the app does not grant access to company documents.

## The broader concept

### Prompt coaching at the point of use

Suggest improvements to clarity, intent, constraints, output format, and missing context. Keep the original request visible so the employee can judge whether a rewrite preserves its meaning. Organisation-defined skills could eventually encode approved practices for common tasks and roles.

The initial brainstorm included silent prompt rewriting. The implemented prototype uses an explicit review step. Any future automatic mode needs a clear account of what changed and how the employee can control it.

### Learning through normal work

Use understandable feedback and examples to help people improve over time. A friendly mascot can make the experience approachable. Optional learning exercises or team challenges could encourage sharing useful practices.

Prompt specificity is a limited writing signal, not a measure of intelligence, productivity, or job performance. Role and task differences make employee rankings difficult to interpret. Public leaderboards, targeted learning recommendations, and inferred break reminders remain exploratory ideas; the prototype does not implement them. The original assumption that everyone is productive for only two or three hours a day is not a validated basis for product behaviour.

### Evidence-aware answers

Retrieve relevant company material, show source passages, make uncertainty visible, and help the employee write a measured response. The product should distinguish documented facts from missing or conflicting information. It should not promise universal hallucination detection.

### Business benchmarking and spend visibility

The proposed second phase compares models on representative business tasks. Record task category, quality assessment, latency, failures, retries, available usage information, and associated costs. Compare options within the same task and quality requirements.

Billing reconciliation would compare recorded usage and invoices against the applicable pricing agreement. A spike is a reason to investigate; a usage average alone cannot prove overbilling. The initial example of a small unexplained charge repeated across many requests is a hypothetical scenario, not evidence of provider misconduct.

Neither billing auditing, automatic model routing, departmental cost dashboards, nor provider negotiation recommendations are implemented in v0.2.1.

## How to evaluate the idea

Run a small pilot with representative tasks and a baseline workflow. Compare the same tasks with and without Impromptu, and have reviewers assess answers using a shared rubric.

Measure useful outcomes: time to an accepted answer, factual and citation accuracy, number of attempts, amount of editing, latency, and total measured cost per accepted result. Count coaching and retrieval costs as part of the workflow. More context can increase tokens for one request while reducing later retries; the overall task result is the relevant comparison.

The prototype has no claimed percentage cost saving, productivity improvement, or model-quality uplift. Those need measured results.

## Proposed next steps

1. Validate the Windows launch, shortcut, clipboard, and connector workflow on a Windows machine.
2. Trial the current application with a small set of representative tasks and collect explicit feedback.
3. Refine retrieval relevance, source freshness, error handling, and the explanation of uncertainty.
4. Add an approved organisation-specific skill catalogue and optional learning exercises.
5. Evaluate a direct organisation-managed authentication and connector architecture if deployment must work without local Codex.
6. Add signed installers and a managed distribution/update process.
7. Build business-model benchmarking and cost reconciliation only after defining the evaluation data and measurements.

The hackathon demonstration should lead with the working employee journey: **a confusing comment becomes documented context and a useful reply**. Cost and learning improvements are outcomes to test, not assumed benefits.
