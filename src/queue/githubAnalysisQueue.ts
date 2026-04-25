import { Queue } from 'bullmq';
import { getRedisConnection } from './redisConnection';

export const GITHUB_ANALYSIS_QUEUE_NAME = 'github-analysis';

export const githubAnalysisQueue = new Queue<{ githubId: string }>(GITHUB_ANALYSIS_QUEUE_NAME, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 8000 },
    removeOnComplete: 200,
    removeOnFail: 100,
  },
});

export async function enqueueGithubAnalysis(githubId: string): Promise<void> {
  await githubAnalysisQueue.add(
    'analyze',
    { githubId },
    { jobId: `analyze-${githubId}-${Date.now()}` }
  );
}
