import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffBlockLabels, ReadBlockLabels, SearchBlockLabels, WebBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'

export function diffBlockLabels(t: TranslateNS<'conversation'>): DiffBlockLabels {
  return {
    copy: t('copy'), copied: t('copied'), collapseAria: t('diff.collapseAria'),
    expandAria: n => t('diff.expandAria', { n }), collapse: t('diff.collapse'),
    expandRest: n => t('diff.expandRest', { n }), file: t('diff.files.one'), files: t('diff.files.other'),
  }
}

export function readBlockLabels(t: TranslateNS<'conversation'>): ReadBlockLabels {
  return {
    showing: (shown, total) => t('read.showing', { shown, total }), copy: t('copy'), copied: t('copied'),
    collapseAria: t('read.collapseAria'), expandAria: n => t('read.expandAria', { n }),
    collapse: t('read.collapse'), expandRest: n => t('read.expandRest', { n }),
  }
}

export function searchBlockLabels(t: TranslateNS<'conversation'>): SearchBlockLabels {
  return {
    summaryPaths: count => t('search.summary.paths', { count }),
    summaryMatches: (count, files) => t('search.summary.matches', { count, files }),
    summaryTruncated: (shown, total) => t('search.summary.truncated', { shown, total }),
    copy: t('copy'), copied: t('copied'), empty: t('search.empty'), collapseAria: t('search.collapseAria'),
    expandAria: n => t('search.expandAria', { n }), collapse: t('search.collapse'), expandRest: n => t('search.expandRest', { n }),
  }
}

export function webBlockLabels(t: TranslateNS<'conversation'>): WebBlockLabels {
  return { empty: t('web.empty'), sourcesTruncated: t('web.sourcesTruncated'), contentTruncated: t('web.contentTruncated') }
}
