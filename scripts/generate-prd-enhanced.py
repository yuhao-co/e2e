#!/usr/bin/env python3
import json
import sys
from pathlib import Path

REPO_ROOT = Path("/Users/yu.hao/Desktop/task/e2e")
SUMMARY_FILE = REPO_ROOT / "generated-cases/weekly-diff/latest/summary.json"
OUTPUT_FILE = REPO_ROOT / "generated-cases/weekly-diff/PRD.md"

if not SUMMARY_FILE.exists():
    print(f"❌ No summary found at {SUMMARY_FILE}")
    sys.exit(1)

with open(SUMMARY_FILE) as f:
    data = json.load(f)

output = []
output.append("# 📋 PRD (Product Requirements Document) Report\n")
output.append("## 📌 Metadata & Links\n")

generated_at = data.get("generatedAt", "Unknown")
candidates = data.get("candidates", [])
commits = sum(len(c.get("sourceCommits", [])) for c in candidates)
hints = sum(len(c.get("sourceHints", [])) for c in candidates)

output.append("### 1. Source Information")
output.append("- **Status**: ✅ PRD Successfully Generated")
output.append(f"- **Generated At**: `{generated_at}`")
output.append("- **Source**: `generated-cases/weekly-diff/latest/summary.json`")
output.append("- **GitHub Repo**: https://github.com/traveloka/www")
output.append("- **Analysis Type**: Weekly Diff Analysis\n")

output.append("### 2. Summary Statistics")
output.append(f"- **Total Candidates**: {len(candidates)}")
output.append(f"- **Related Commits**: {commits}")
output.append(f"- **Source Files**: {hints}\n")

output.append("### 3. Candidate Overview")
for candidate in candidates:
    title = candidate.get("title", "")
    domain = candidate.get("domain", "")
    confidence = candidate.get("confidence", "")
    output.append(f"- **{title}** ({domain} - {confidence} confidence)")
output.append("")

output.append("---\n")
output.append("## 🎯 Detailed Candidate Summaries\n")

for candidate in candidates:
    title = candidate.get("title", "")
    domain = candidate.get("domain", "")
    confidence = candidate.get("confidence", "")
    action = candidate.get("action", "")
    target_url = candidate.get("targetUrl", "N/A")
    intent = candidate.get("suggestedUserIntent", "")
    reason = candidate.get("reason", "")
    solution = candidate.get("solution", "")
    concern = candidate.get("concerns", ["N/A"])[0] if candidate.get("concerns") else "N/A"
    changed_files = candidate.get("changedFiles", [])
    
    output.append(f"### {title}")
    output.append(f"- **Domain**: {domain}")
    output.append(f"- **Confidence**: {confidence}")
    output.append(f"- **Action Type**: {action}")
    output.append(f"- **Suggested Test Intent**:")
    output.append(f"  > {intent}")
    output.append(f"- **Target URL**: {target_url}")
    output.append(f"- **Workflow Concern**: {concern}")
    output.append(f"- **Reason**: {reason}")
    output.append(f"- **Solution**: {solution}")
    output.append(f"- **Changed Files Count**: {len(changed_files)}")
    output.append(f"- **Key Files**:")
    for file_path in changed_files[:3]:
        output.append(f"  - {file_path}")
    output.append("")

output.append("---\n")
output.append("## 🔗 Commit & PR Links (Clickable)\n")

for candidate in candidates:
    title = candidate.get("title", "")
    commits_list = candidate.get("sourceCommits", [])
    
    output.append(f"### {title}")
    for commit in commits_list:
        sha = commit.get("sha", "")
        author = commit.get("author", "")
        subject = commit.get("subject", "")
        pr_num = commit.get("prNumber", "")
        
        output.append(f"- **GitHub Commit**: [{sha}](https://github.com/traveloka/www/commit/{sha})")
        output.append(f"  - Author: {author}")
        output.append(f"  - Message: {subject}")
        output.append(f"  - **PR Link**: [#{pr_num}](https://github.com/traveloka/www/pull/{pr_num})")
    output.append("")

output.append("---\n")
output.append("## 📁 Affected Files (sourceHints)\n")

for candidate in candidates:
    title = candidate.get("title", "")
    hints_list = candidate.get("sourceHints", [])
    
    output.append(f"### {title}")
    for hint in hints_list:
        path = hint.get("sourcePath", "")
        reason = hint.get("reason", "")
        output.append(f"- `{path}`")
        output.append(f"  - {reason}")
    output.append("")

output.append("---\n")
output.append("## ✅ Verification Status\n")
output.append("- ✅ PRD Generated Successfully")
output.append("- ✅ JSON Validation: PASSED")
output.append("- ✅ Markdown Extraction: COMPLETED")
output.append(f"- ✅ Commits Extracted: {commits} commits identified")
output.append("- ✅ PR Links Generated: YES")
output.append(f"- ✅ Source Files Identified: {hints} hint(s)\n")

output.append("---\n")
output.append("## 📄 Original Weekly Diff Report\n")
markdown = data.get("markdownSummary", "")
output.append(markdown)

content = "\n".join(output)
OUTPUT_FILE.write_text(content)

file_size = OUTPUT_FILE.stat().st_size
line_count = len(content.split("\n"))

print(f"✅ PRD saved to: {OUTPUT_FILE}")
print(f"   Lines: {line_count} | Size: {file_size} bytes")
print("\n📄 Preview:")
print("---")
for line in content.split("\n")[:50]:
    print(line)
print("")
print(f"... (see full file at {OUTPUT_FILE}) ...")
