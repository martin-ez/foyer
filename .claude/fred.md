Tracker: GitHub Issues in martin-ez/foyer
Statuses: one `status:` label on each open issue (`status:inbox`, `status:needs-decision`, `status:ready`, `status:in-progress`, `status:in-review`); Done is an issue closed as completed, Dropped is an issue closed as not planned
Source: a `source:user` or `source:agent` label
Blockers: GitHub's native "blocked by" issue dependency (REST `POST /repos/martin-ez/foyer/issues/{number}/dependencies/blocked_by` with the blocking issue's `issue_id`; `GET` on the same path lists them)
Done: the pull request description says "Closes #N", with the keyword before every issue; squash-merging into `main` closes each one as completed
Background research is kept outside the repository; never commit it.
