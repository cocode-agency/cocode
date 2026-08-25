import type { GitHubRef } from './github-ref.ts'
import css from './MarkdownText.module.css'

function GitHubMark() {
  return (
    <svg
      className={css.githubRefIcon}
      viewBox="0 0 16 16"
      width={14}
      height={14}
      aria-hidden
    >
      <circle cx={8} cy={8} r={8} fill="currentColor" />
      <path
        fill="var(--dsw-alias-label-inverse)"
        d="M8 1.25c-3.73 0-6.75 3.02-6.75 6.75 0 2.98 1.93 5.5 4.61 6.39.34.06.46-.15.46-.33 0-.16-.01-.7-.01-1.27-1.88.41-2.27-.45-2.27-.45-.31-.78-.75-.99-.75-.99-.61-.42.05-.41.05-.41.68.05 1.04.7 1.04.7.6 1.03 1.57.73 1.95.56.06-.44.23-.73.42-.9-1.5-.17-3.07-.75-3.07-3.34 0-.74.26-1.34.7-1.81-.07-.17-.3-.86.07-1.79 0 0 .57-.18 1.87.69.54-.15 1.12-.23 1.7-.23.58 0 1.16.08 1.7.23 1.3-.87 1.87-.69 1.87-.69.37.93.14 1.62.07 1.79.44.47.7 1.07.7 1.81 0 2.6-1.58 3.17-3.09 3.33.24.21.46.62.46 1.25 0 .9-.01 1.63-.01 1.85 0 .18.12.39.47.33 2.68-.89 4.61-3.41 4.61-6.39 0-3.73-3.02-6.75-6.75-6.75Z"
      />
    </svg>
  )
}

/** Compact GitHub issue / PR chip: octocat badge + #number. */
export function GitHubRefLink({ href, ref }: { href: string; ref: GitHubRef }) {
  return (
    <a
      className={css.githubRef}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${ref.owner}/${ref.repo} ${ref.kind} #${ref.number}`}
    >
      <GitHubMark />
      <span className={css.githubRefNumber}>#{ref.number}</span>
    </a>
  )
}
