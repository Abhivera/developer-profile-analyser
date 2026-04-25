import axios from 'axios';
import {
  GithubUserAnalysis,
  type ICrawlSnapshot,
  type IExternalProfiles,
  type IProfileEvaluation,
} from '../models/UserAnalysis';
import { crawlUrlWithCrawl4ai } from './crawl4aiRunner';
import { evaluateProfileWithGroq } from './groqService';

function normalizeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith('http://') || t.startsWith('https://')) return t;
  if (t.includes(' ') || t.startsWith('//')) return null;
  if (t.includes('.')) return `https://${t}`;
  return null;
}

function pickUniqueHttpUrls(...candidates: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const n = typeof c === 'string' ? normalizeHttpUrl(c) : null;
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 8) break;
  }
  return out;
}

function extractUrlsFromText(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const matches = raw.match(/https?:\/\/[^\s)]+/gi) || [];
  return pickUniqueHttpUrls(...matches);
}

function classifyExternalProfiles(urls: string[]): IExternalProfiles {
  const out: IExternalProfiles = {
    linkedin: [],
    leetcode: [],
    hackerrank: [],
    topcoder: [],
    codeforces: [],
    atcoder: [],
    codechef: [],
    hackerearth: [],
    codility: [],
    interviewbit: [],
  };
  for (const url of urls) {
    const l = url.toLowerCase();
    if (l.includes('linkedin.com')) out.linkedin.push(url);
    if (l.includes('leetcode.com')) out.leetcode.push(url);
    if (l.includes('hackerrank.com')) out.hackerrank.push(url);
    if (l.includes('topcoder.com')) out.topcoder.push(url);
    if (l.includes('codeforces.com')) out.codeforces.push(url);
    if (l.includes('atcoder.jp')) out.atcoder.push(url);
    if (l.includes('codechef.com')) out.codechef.push(url);
    if (l.includes('hackerearth.com')) out.hackerearth.push(url);
    if (l.includes('codility.com')) out.codility.push(url);
    if (l.includes('interviewbit.com')) out.interviewbit.push(url);
  }
  return out;
}

function deterministicEvaluation(
  formattedRepos: Array<{
    name: string;
    description: string;
    language: string;
    stars: number;
    forks: number;
    url: string;
  }>,
  totals: {
    totalStars: number;
    totalForks: number;
    primaryLanguage: string;
    languageDiversity: number;
  },
  externalProfiles: IExternalProfiles,
  languageUsageByRepositoryCount: Array<{ language: string; repoCount: number }>
): IProfileEvaluation {
  let score = 0;
  score += Math.min(totals.totalStars * 2, 50);
  score += Math.min(formattedRepos.length, 30);
  score += Math.min(totals.languageDiversity * 5, 20);

  return {
    totalStars: totals.totalStars,
    totalForks: totals.totalForks,
    totalRepositories: formattedRepos.length,
    primaryLanguage: totals.primaryLanguage,
    languageDiversity: totals.languageDiversity,
    score,
    judgmentMessage: `This profile scores about ${score}/100 on a simple activity heuristic. Primary language surface: ${totals.primaryLanguage}, with ${totals.totalStars} total stars across public repositories.`,
    highlights: [],
    risksOrGaps: [],
    externalProfiles,
    languageUsageByRepositoryCount,
    tokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    model: 'deterministic-fallback',
  };
}

/**
 * Full pipeline: GitHub APIs → optional crawl4ai on profile/homepage URLs → Groq evaluation → MongoDB.
 * Invoked by the BullMQ worker only (not the HTTP request thread).
 */
export async function runGithubAnalysisJob(githubId: string): Promise<void> {
  const user = await GithubUserAnalysis.findOne({ githubId });
  if (!user) return;

  console.info('[analysis] job started', { githubId, username: user.username });
  user.status = 'processing';
  user.crawlSnapshots = [];
  await user.save();

  try {
    const accessToken = user.accessToken;

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
    };

    const [profileRes, reposResponse] = await Promise.all([
      axios.get('https://api.github.com/user', { headers }),
      axios.get('https://api.github.com/user/repos?per_page=100&sort=updated', { headers }),
    ]);

    const githubUser = profileRes.data as Record<string, unknown>;
    const reposData = reposResponse.data as any[];

    const twitter = githubUser.twitter_username;
    const twitterUrl =
      typeof twitter === 'string' && twitter.trim()
        ? `https://twitter.com/${twitter.trim()}`
        : undefined;

    const profileUrls = pickUniqueHttpUrls(
      githubUser.blog as string | undefined,
      githubUser.html_url as string | undefined,
      twitterUrl
    );

    const bioUrls = extractUrlsFromText(
      typeof githubUser.bio === 'string' ? githubUser.bio : undefined
    );

    const repoHomepages = reposData
      .map((r) => (typeof r.homepage === 'string' ? r.homepage : null))
      .map((h) => normalizeHttpUrl(h))
      .filter((h): h is string => Boolean(h))
      .slice(0, 8);

    const externalProfiles = classifyExternalProfiles([
      ...profileUrls,
      ...bioUrls,
      ...repoHomepages,
    ]);

    const urlsToCrawl = pickUniqueHttpUrls(...profileUrls, ...bioUrls, ...repoHomepages).slice(
      0,
      Number(process.env.MAX_CRAWL_URLS) || 3
    );
    console.info('[analysis] crawl targets prepared', {
      githubId,
      username: user.username,
      urlsToCrawlCount: urlsToCrawl.length,
      urlsToCrawl,
      externalProfiles,
    });

    const formattedRepos = reposData.map((repo: any) => ({
      name: repo.name,
      description: repo.description || '',
      language: repo.language || 'Unknown',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      url: repo.html_url,
    }));

    user.repositories = formattedRepos;

    const crawlSnapshots: ICrawlSnapshot[] = [];
    for (const url of urlsToCrawl) {
      const crawlStart = Date.now();
      console.info('[analysis] crawling url', { githubId, url });
      const r = await crawlUrlWithCrawl4ai(url);
      console.info('[analysis] crawl result', {
        githubId,
        url,
        ok: r.ok,
        statusCode: r.statusCode,
        elapsedMs: Date.now() - crawlStart,
        error: r.error,
        markdownChars: r.markdown?.length ?? 0,
      });
      crawlSnapshots.push({
        url,
        success: r.ok,
        markdownPreview: r.ok && r.markdown ? r.markdown.slice(0, 50_000) : undefined,
        error: r.ok ? undefined : r.error,
        statusCode: r.statusCode,
        fetchedAt: new Date(),
      });
    }
    user.crawlSnapshots = crawlSnapshots;

    let totalStars = 0;
    let totalForks = 0;
    const languageCounts: Record<string, number> = {};

    formattedRepos.forEach((repo) => {
      totalStars += repo.stars;
      totalForks += repo.forks;
      if (repo.language && repo.language !== 'Unknown') {
        languageCounts[repo.language] = (languageCounts[repo.language] || 0) + 1;
      }
    });

    let primaryLanguage = 'Unknown';
    let maxCount = 0;
    for (const [lang, count] of Object.entries(languageCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryLanguage = lang;
      }
    }

    const languageDiversity = Object.keys(languageCounts).length;
    const sortedLanguageUsage = Object.entries(languageCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([language, repoCount]) => ({ language, repoCount }));

    const repoSummary = JSON.stringify(
      {
        username: user.username,
        githubBio: typeof githubUser.bio === 'string' ? githubUser.bio : '',
        externalProfiles,
        totals: {
          totalStars,
          totalForks,
          totalRepositories: formattedRepos.length,
          primaryLanguage,
          languageDiversity,
        },
        languageUsageByRepositoryCount: sortedLanguageUsage,
        topRepositories: formattedRepos.slice(0, 20),
      },
      null,
      2
    );

    const crawlContext = crawlSnapshots
      .filter((s) => s.markdownPreview)
      .map((s) => `### ${s.url}\n${(s.markdownPreview as string).slice(0, 12_000)}`)
      .join('\n\n');

    const groqEval = await evaluateProfileWithGroq({
      username: user.username,
      repoSummary,
      crawlContext,
    });

    const fallback = deterministicEvaluation(
      formattedRepos,
      {
      totalStars,
      totalForks,
      primaryLanguage,
      languageDiversity,
      },
      externalProfiles,
      sortedLanguageUsage
    );

    const mergedGroqEvaluation: IProfileEvaluation | null = groqEval
      ? {
          totalStars: groqEval.evaluation.totalStars,
          totalForks: groqEval.evaluation.totalForks,
          totalRepositories: groqEval.evaluation.totalRepositories,
          primaryLanguage: groqEval.evaluation.primaryLanguage,
          languageDiversity: groqEval.evaluation.languageDiversity,
          score: groqEval.evaluation.score,
          judgmentMessage: groqEval.evaluation.judgmentMessage,
          highlights: groqEval.evaluation.highlights || [],
          risksOrGaps: groqEval.evaluation.risksOrGaps || [],
          externalProfiles,
          languageUsageByRepositoryCount: sortedLanguageUsage,
          tokenUsage: groqEval.tokenUsage,
          model: groqEval.model,
        }
      : null;

    user.evaluation = mergedGroqEvaluation ?? fallback;
    user.status = 'completed';
    await user.save();
    console.info('[analysis] job completed', {
      githubId,
      username: user.username,
      status: user.status,
      usedGroq: Boolean(mergedGroqEvaluation),
      tokenUsage: user.evaluation?.tokenUsage,
    });
  } catch (error) {
    console.error(`Error analyzing GitHub user ${githubId}:`, error);
    const failed = await GithubUserAnalysis.findOne({ githubId });
    if (failed) {
      failed.status = 'failed';
      await failed.save();
    }
  }
}
